#!/usr/bin/env python3
# Model-store recovery (req_2082/2083). Streams the model event log through a
# faithful 1:1 port of modelStream.apply (cart/hmsc-int/editors/model/modelStream.ts),
# producing a corrected snapshot. The v8cli SQL binding can't return the 544MB
# result set, so we stream in Python (no memory ceiling). VALIDATED against the
# _compact_backup snapshot (59 models @ seq 15613) before trusting the full replay.
import json, sqlite3, sys

WORK = '/home/siah/creative/reactjit/_model-recover-work'
DB = f'{WORK}/store.db'

def insert_after(order, pid, after):
    if pid in order: return order
    i = order.index(after) if (after and after in order) else -1
    if i < 0: return [pid] + order
    return order[:i+1] + [pid] + order[i+1:]

def swap(order, pid, d):
    if pid not in order: return order
    i = order.index(pid); j = i-1 if d == 'up' else i+1
    if j < 0 or j >= len(order): return order
    order = list(order); order[i], order[j] = order[j], order[i]; return order

def replay(limit_seq):
    models, order, blobs = {}, [], {}
    folded, maxseq = 0, 0
    con = sqlite3.connect(f'file:{DB}?mode=ro', uri=True)
    cur = con.execute("SELECT seq, record FROM events WHERE stream='model' AND seq<=? ORDER BY id", (limit_seq,))
    for seq, record in cur:
        ev = json.loads(record)['event']; k = ev.get('kind')
        mid = ev.get('model')  # pre-req_0998 part events have no model → no-op (TS: state.models[undefined])
        if k == 'modelCreated':
            if mid not in models:
                models[mid] = {'id': mid, 'name': ev['name'], 'parts': {}, 'order': []}
                order.append(mid)
        elif k == 'modelRenamed':
            if mid in models: models[mid]['name'] = ev['name']
        elif k == 'modelDeleted':
            if mid in models:
                del models[mid]; order = [x for x in order if x != mid]
        elif k == 'modelPaletteSet':
            if mid in models: models[mid]['palette'] = ev['palette']
        elif k == 'modelDecalsSet':
            m = models.get(mid)
            if m is not None:
                if ev['decals']: m['decals'] = ev['decals']
                else: m.pop('decals', None)
        elif k == 'modelSeatRigSet':
            m = models.get(mid)
            if m is not None:
                if ev['seatRig']: m['seatRig'] = ev['seatRig']
                else: m.pop('seatRig', None)
        elif k == 'modelPaintBaked':
            m = models.get(mid)
            if m is not None:
                ref = ev['paintRef']; prior = m.get('paintRef')
                if ev.get('blobB64') and ref not in blobs: blobs[ref] = ev['blobB64']
                m['paintRef'] = ref
                if prior and prior != ref and prior in blobs and not any(mm.get('paintRef') == prior for mm in models.values()):
                    del blobs[prior]
        elif k == 'partAdded':
            m = models.get(mid)
            if m is not None and 'part' in ev:
                m['parts'][ev['part']['id']] = ev['part']
                m['order'] = insert_after(m['order'], ev['part']['id'], ev.get('afterId'))
        elif k in ('partMeshUpdated', 'partPaintUpdated', 'partRenamed', 'partVisibilitySet', 'partReordered', 'partRemoved'):
            # TS reads event.X as undefined when absent (old flat-library / crash-truncated
            # events) — {...prev, mesh: undefined} drops the key on JSON.stringify. Mirror that.
            m = models.get(mid)
            if m is not None:
                pid = ev.get('id'); p = m['parts'].get(pid)
                if k == 'partMeshUpdated':
                    if p is not None:
                        p['version'] = p.get('version', 0) + 1
                        if 'mesh' in ev: p['mesh'] = ev['mesh']
                        else: p.pop('mesh', None)
                elif k == 'partPaintUpdated':
                    if p is not None:
                        if 'paint' in ev: p['paint'] = ev['paint']
                        else: p.pop('paint', None)
                elif k == 'partRenamed':
                    if p is not None: p['name'] = ev.get('name')
                elif k == 'partVisibilitySet':
                    if p is not None: p['visible'] = ev.get('visible')
                elif k == 'partReordered':
                    m['order'] = swap(m['order'], pid, ev.get('dir'))
                elif k == 'partRemoved':
                    if pid in m['parts']:
                        del m['parts'][pid]; m['order'] = [x for x in m['order'] if x != pid]
        folded += 1
        if seq > maxseq: maxseq = seq
    con.close()
    state = {'models': models, 'order': order, 'paintBlobs': blobs}
    return state, folded, maxseq

def fingerprint(state):
    ms = state['models']
    return {
        'count': len(ms),
        'ids': sorted(ms.keys()),
        'per': {mid: (m['name'], len(m['parts']), sorted(m['parts'].keys()), m['order'], m.get('paintRef')) for mid, m in ms.items()},
        'blobs': sorted(state['paintBlobs'].keys()),
    }

# ── 1) PARITY CHECK against _compact_backup (seq 15613) — FULL deep equality ─────
# Replaying to the same seq must reproduce the real reducer's snapshot BYTE-FOR-BYTE
# (models, parts, meshes, paint, paintBlobs) — that's what proves this port faithful.
def canon(x): return json.dumps(x, sort_keys=True, separators=(',', ':'))
ref = json.load(open(f'{WORK}/_compact_backup/model.snapshot.json'))
ref_seq = ref['globalSeq']
got, folded, _ = replay(ref_seq)
if canon(got) != canon(ref['state']):
    fa, fb = fingerprint(got), fingerprint(ref['state'])
    print(f'[recover] PARITY FAILED at seq {ref_seq}: replay={fa["count"]} ref={fb["count"]} models')
    for key in ('count', 'ids', 'blobs'):
        if fa[key] != fb[key]: print(f'   diff in {key}: replay-only={set(map(str,fa[key]))-set(map(str,fb[key])) if isinstance(fa[key],list) else fa[key]}')
    if fa['ids'] == fb['ids']:
        for mid in fa['ids']:
            if canon(got['models'][mid]) != canon(ref['state']['models'][mid]):
                gm, rm = got['models'][mid], ref['state']['models'][mid]
                print(f'   model {mid} ({rm.get("name")}) differs; keys r={sorted(gm)} ref={sorted(rm)}')
                for pid in rm.get('parts', {}):
                    if canon(gm['parts'].get(pid)) != canon(rm['parts'].get(pid)):
                        print(f'     part {pid}: replay-keys={sorted(gm["parts"].get(pid,{}))} ref-keys={sorted(rm["parts"].get(pid,{}))}'); break
                break
    sys.exit(1)
print(f'[recover] PARITY OK at seq {ref_seq}: full deep-equality vs _compact_backup ({len(got["models"])} models, folded {folded}, ref events {ref["events"]})')

# ── 2) FULL replay → corrected snapshot ─────────────────────────────────────────
state, folded, maxseq = replay(10**18)
con = sqlite3.connect(f'file:{DB}?mode=ro', uri=True)
events_count = con.execute("SELECT COUNT(*) FROM events WHERE stream='model' AND seq<=?", (maxseq,)).fetchone()[0]
con.close()
snap = {'name': 'model', 'globalSeq': maxseq, 'events': events_count, 'state': state}
out = f'{WORK}/snapshots/model.snapshot.json'
with open(out, 'w') as f: json.dump(snap, f, separators=(',', ':'))
import os
print(f'[recover] FULL replay: {len(state["models"])} models, {len(state["paintBlobs"])} paintBlobs, folded {folded}, globalSeq {maxseq}, events {events_count}')
print(f'[recover] wrote {out} ({os.path.getsize(out)//1024} KB)')
print('[recover] names: ' + ', '.join(sorted(m['name'] for m in state['models'].values())))
