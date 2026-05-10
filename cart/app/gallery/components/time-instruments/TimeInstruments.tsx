import { useEffect, useState } from 'react';
import { classifiers as S } from '@reactjit/core';
import { CTRL } from '../controls-specimen/controlsSpecimenTheme';
import { useAnimationsDisabled } from '../../lib/useSpring';

type TimeInstrumentProps = {
  now?: Date;
  width?: number;
};

type TimeParts = {
  hour: number;
  minute: number;
  second: number;
  year: number;
  time: string;
  date: string;
  secondsOfDay: number;
  dayProgress: number;
  weekProgress: number;
  yearProgress: number;
};

type WordCell = {
  key: string;
  label: string;
};

const BIT_WEIGHTS = [8, 4, 2, 1];
const DAY_SECONDS = 24 * 60 * 60;
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WORD_ROWS: WordCell[][] = [
  [
    { key: 'it', label: 'IT' },
    { key: 'is', label: 'IS' },
    { key: 'five-min', label: 'FIVE' },
    { key: 'ten-min', label: 'TEN' },
    { key: 'quarter', label: 'QUARTER' },
  ],
  [
    { key: 'twenty', label: 'TWENTY' },
    { key: 'half', label: 'HALF' },
    { key: 'past', label: 'PAST' },
    { key: 'to', label: 'TO' },
  ],
  [
    { key: 'hour-1', label: 'ONE' },
    { key: 'hour-2', label: 'TWO' },
    { key: 'hour-3', label: 'THREE' },
    { key: 'hour-4', label: 'FOUR' },
  ],
  [
    { key: 'hour-5', label: 'FIVE' },
    { key: 'hour-6', label: 'SIX' },
    { key: 'hour-7', label: 'SEVEN' },
    { key: 'hour-8', label: 'EIGHT' },
  ],
  [
    { key: 'hour-9', label: 'NINE' },
    { key: 'hour-10', label: 'TEN' },
    { key: 'hour-11', label: 'ELEVEN' },
    { key: 'hour-12', label: 'TWELVE' },
  ],
  [
    { key: 'oclock', label: "O'CLOCK" },
    { key: 'local', label: 'LOCAL' },
  ],
];
const HOUR_WORDS: Record<number, string> = {
  1: 'ONE',
  2: 'TWO',
  3: 'THREE',
  4: 'FOUR',
  5: 'FIVE',
  6: 'SIX',
  7: 'SEVEN',
  8: 'EIGHT',
  9: 'NINE',
  10: 'TEN',
  11: 'ELEVEN',
  12: 'TWELVE',
};
const WORD_LABELS: Record<string, string> = {
  'five-min': 'FIVE',
  'ten-min': 'TEN',
  quarter: 'QUARTER',
  twenty: 'TWENTY',
  half: 'HALF',
  past: 'PAST',
  to: 'TO',
  oclock: "O'CLOCK",
};

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function percent(value: number): string {
  return `${Math.round(clamp01(value) * 1000) / 10}%`;
}

function useClockNow(explicitNow?: Date): Date {
  const animationsDisabled = useAnimationsDisabled();
  const [liveNow, setLiveNow] = useState(() => explicitNow ?? new Date());

  useEffect(() => {
    if (explicitNow) {
      setLiveNow(explicitNow);
      return;
    }
    if (animationsDisabled) return;

    const id = setInterval(() => setLiveNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [explicitNow, animationsDisabled]);

  return explicitNow ?? liveNow;
}

function getTimeParts(now: Date): TimeParts {
  const hour = now.getHours();
  const minute = now.getMinutes();
  const second = now.getSeconds();
  const secondsOfDay = hour * 3600 + minute * 60 + second;
  const startOfYear = new Date(now.getFullYear(), 0, 1).getTime();
  const startOfNextYear = new Date(now.getFullYear() + 1, 0, 1).getTime();
  const yearSpan = Math.max(1, startOfNextYear - startOfYear);
  const dayProgress = secondsOfDay / DAY_SECONDS;
  const weekProgress = (now.getDay() + dayProgress) / 7;
  const yearProgress = (now.getTime() - startOfYear) / yearSpan;

  return {
    hour,
    minute,
    second,
    year: now.getFullYear(),
    time: `${pad2(hour)}:${pad2(minute)}:${pad2(second)}`,
    date: `${WEEKDAYS[now.getDay()] ?? ''} ${MONTHS[now.getMonth()] ?? ''} ${pad2(now.getDate())}`,
    secondsOfDay,
    dayProgress,
    weekProgress,
    yearProgress,
  };
}

function phaseLabel(hour: number): string {
  if (hour < 5) return 'NIGHT';
  if (hour < 8) return 'DAWN';
  if (hour < 17) return 'DAY';
  if (hour < 20) return 'DUSK';
  return 'NIGHT';
}

function TimeShell(props: {
  eyebrow: string;
  title: string;
  right: string;
  children: any;
  width?: number;
}) {
  return (
    <S.Card
      style={{
        width: props.width ?? 560,
        minWidth: 0,
        borderWidth: 1,
        borderColor: CTRL.ruleBright,
        backgroundColor: CTRL.bg1,
      }}
    >
      <S.CardHeader>
        <S.StackX1>
          <S.MenuEyebrow numberOfLines={1}>{props.eyebrow}</S.MenuEyebrow>
          <S.Headline numberOfLines={1}>{props.title}</S.Headline>
        </S.StackX1>
        <S.BadgeAccent>
          <S.BadgeAccentText style={{ fontFamily: CTRL.mono, letterSpacing: 1.2 }} numberOfLines={1}>
            {props.right}
          </S.BadgeAccentText>
        </S.BadgeAccent>
      </S.CardHeader>
      <S.CardBody>{props.children}</S.CardBody>
    </S.Card>
  );
}

function BinaryBit(props: { active: boolean; tone: string }) {
  return (
    <S.DotMd
      style={{
        width: 22,
        height: 22,
        borderRadius: 5,
        borderColor: props.active ? props.tone : CTRL.rule,
        backgroundColor: props.active ? props.tone : CTRL.bg,
        opacity: props.active ? 1 : 0.42,
      }}
    />
  );
}

function BinaryColumn(props: { digit: number; label: string; tone: string }) {
  return (
    <S.StackX2 style={{ alignItems: 'center', minWidth: 36 }}>
      {BIT_WEIGHTS.map((weight) => (
        <BinaryBit key={`${props.label}-${weight}`} active={(props.digit & weight) !== 0} tone={props.tone} />
      ))}
      <S.TypeTiny style={{ color: CTRL.inkDimmer, lineHeight: 10 }} numberOfLines={1}>
        {props.label}
      </S.TypeTiny>
    </S.StackX2>
  );
}

function BitWeightColumn() {
  return (
    <S.StackX2 style={{ alignItems: 'flex-end', width: 18 }}>
      {BIT_WEIGHTS.map((weight) => (
        <S.TypeTiny key={weight} style={{ color: CTRL.inkGhost, height: 22, lineHeight: 22 }} numberOfLines={1}>
          {weight}
        </S.TypeTiny>
      ))}
      <S.TypeTiny style={{ color: CTRL.inkGhost, lineHeight: 10 }} numberOfLines={1}>
        B
      </S.TypeTiny>
    </S.StackX2>
  );
}

function BinarySeparator() {
  return <S.VertDivider style={{ height: 108, backgroundColor: CTRL.rule, marginLeft: 2, marginRight: 2 }} />;
}

export function BinaryClock(props: TimeInstrumentProps) {
  const now = useClockNow(props.now);
  const parts = getTimeParts(now);
  const digits = [
    Math.floor(parts.hour / 10),
    parts.hour % 10,
    Math.floor(parts.minute / 10),
    parts.minute % 10,
    Math.floor(parts.second / 10),
    parts.second % 10,
  ];

  return (
    <TimeShell eyebrow="TIME / BCD" title="Binary Clock" right={parts.time} width={props.width}>
      <S.Surface style={{ borderWidth: 1, borderColor: CTRL.rule, backgroundColor: CTRL.bg }}>
        <S.StackX4>
          <S.InlineX5Between style={{ width: '100%', alignItems: 'flex-end' }}>
            <S.Code style={{ color: CTRL.ink, fontSize: 30, lineHeight: 32, letterSpacing: 2.2 }} numberOfLines={1}>
              {parts.time}
            </S.Code>
            <S.StackX1 style={{ alignItems: 'flex-end' }}>
              <S.TypeTiny style={{ color: CTRL.inkDimmer }} numberOfLines={1}>
                {parts.date}
              </S.TypeTiny>
              <S.TypeTinyBold style={{ color: CTRL.accentHot }} numberOfLines={1}>
                {phaseLabel(parts.hour)}
              </S.TypeTinyBold>
            </S.StackX1>
          </S.InlineX5Between>

          <S.InlineX5 style={{ alignItems: 'flex-start' }}>
            <BitWeightColumn />
            <BinaryColumn digit={digits[0]} label="H10" tone={CTRL.blue} />
            <BinaryColumn digit={digits[1]} label="H1" tone={CTRL.blue} />
            <BinarySeparator />
            <BinaryColumn digit={digits[2]} label="M10" tone={CTRL.accent} />
            <BinaryColumn digit={digits[3]} label="M1" tone={CTRL.accent} />
            <BinarySeparator />
            <BinaryColumn digit={digits[4]} label="S10" tone={CTRL.ok} />
            <BinaryColumn digit={digits[5]} label="S1" tone={CTRL.ok} />
          </S.InlineX5>
        </S.StackX4>
      </S.Surface>
    </TimeShell>
  );
}

function phraseForTime(hour: number, minute: number): { text: string; active: Set<string> } {
  let rounded = Math.round(minute / 5) * 5;
  let displayHour = hour;
  if (rounded === 60) {
    rounded = 0;
    displayHour += 1;
  }
  if (rounded > 30) displayHour += 1;

  const hour12 = ((displayHour % 12) + 12) % 12 || 12;
  const active = new Set<string>(['it', 'is', `hour-${hour12}`, 'local']);
  const phrase: Record<number, string[]> = {
    0: ['oclock'],
    5: ['five-min', 'past'],
    10: ['ten-min', 'past'],
    15: ['quarter', 'past'],
    20: ['twenty', 'past'],
    25: ['twenty', 'five-min', 'past'],
    30: ['half', 'past'],
    35: ['twenty', 'five-min', 'to'],
    40: ['twenty', 'to'],
    45: ['quarter', 'to'],
    50: ['ten-min', 'to'],
    55: ['five-min', 'to'],
  };

  const phraseKeys = phrase[rounded] ?? ['oclock'];
  for (const key of phraseKeys) active.add(key);

  const words = ['IT', 'IS'];
  if (rounded === 0) {
    words.push(HOUR_WORDS[hour12] ?? '', WORD_LABELS.oclock);
  } else {
    words.push(...phraseKeys.map((key) => WORD_LABELS[key] ?? key.toUpperCase()), HOUR_WORDS[hour12] ?? '');
  }

  return { text: words.join(' '), active };
}

function WordCellView(props: { cell: WordCell; active: boolean }) {
  return (
    <S.ChipRound
      style={{
        minWidth: 58,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: props.active ? CTRL.accentHot : CTRL.bg,
        borderColor: props.active ? CTRL.accentHot : CTRL.rule,
      }}
    >
      <S.TypeTinyBold
        style={{
          color: props.active ? CTRL.bg : CTRL.inkDimmer,
          letterSpacing: 1.2,
          lineHeight: 10,
        }}
        numberOfLines={1}
      >
        {props.cell.label}
      </S.TypeTinyBold>
    </S.ChipRound>
  );
}

export function WordClock(props: TimeInstrumentProps) {
  const now = useClockNow(props.now);
  const parts = getTimeParts(now);
  const phrase = phraseForTime(parts.hour, parts.minute);

  return (
    <TimeShell eyebrow="TIME / WORDS" title="Word Clock" right={parts.time} width={props.width}>
      <S.Surface style={{ borderWidth: 1, borderColor: CTRL.rule, backgroundColor: CTRL.bg }}>
        <S.StackX4>
          <S.InlineX5Between style={{ width: '100%' }}>
            <S.Code style={{ color: CTRL.accentHot, fontSize: 14, lineHeight: 18, letterSpacing: 1.4 }} numberOfLines={1}>
              {phrase.text}
            </S.Code>
            <S.TypeTiny style={{ color: CTRL.inkDimmer }} numberOfLines={1}>
              NEAREST 5 MIN
            </S.TypeTiny>
          </S.InlineX5Between>
          <S.StackX2>
            {WORD_ROWS.map((row, rowIndex) => (
              <S.InlineX2 key={`word-row-${rowIndex}`} style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
                {row.map((cell) => (
                  <WordCellView key={cell.key} cell={cell} active={phrase.active.has(cell.key)} />
                ))}
              </S.InlineX2>
            ))}
          </S.StackX2>
        </S.StackX4>
      </S.Surface>
    </TimeShell>
  );
}

function ProgressLine(props: { label: string; value: string; progress: number; tone: string }) {
  return (
    <S.StackX2>
      <S.InlineX5Between style={{ width: '100%' }}>
        <S.TypeTinyBold style={{ color: props.tone, letterSpacing: 1.2 }} numberOfLines={1}>
          {props.label}
        </S.TypeTinyBold>
        <S.TypeTiny style={{ color: CTRL.inkDimmer }} numberOfLines={1}>
          {props.value}
        </S.TypeTiny>
      </S.InlineX5Between>
      <S.Track style={{ height: 7, backgroundColor: CTRL.bg }}>
        <S.Fill style={{ width: percent(props.progress), height: 7, backgroundColor: props.tone }} />
      </S.Track>
    </S.StackX2>
  );
}

function HourTicks(props: { hour: number }) {
  return (
    <S.InlineX2 style={{ width: '100%', justifyContent: 'center' }}>
      {Array.from({ length: 24 }).map((_, index) => {
        const isCurrent = index === props.hour;
        const isPast = index < props.hour;
        return (
          <S.DotSm
            key={`hour-${index}`}
            style={{
              width: 14,
              height: isCurrent ? 24 : index % 6 === 0 ? 18 : 12,
              borderRadius: 2,
              backgroundColor: isCurrent ? CTRL.accentHot : isPast ? CTRL.accent : CTRL.bg,
              borderWidth: 1,
              borderColor: isCurrent ? CTRL.accentHot : CTRL.rule,
              opacity: isCurrent || isPast ? 1 : 0.52,
            }}
          />
        );
      })}
    </S.InlineX2>
  );
}

export function TimeRibbons(props: TimeInstrumentProps) {
  const now = useClockNow(props.now);
  const parts = getTimeParts(now);
  const dayRemaining = Math.max(0, DAY_SECONDS - parts.secondsOfDay);
  const remainingHours = Math.floor(dayRemaining / 3600);
  const remainingMinutes = Math.floor((dayRemaining % 3600) / 60);

  return (
    <TimeShell eyebrow="TIME / RIBBONS" title="Day, Week, Year" right={parts.date} width={props.width}>
      <S.Surface style={{ borderWidth: 1, borderColor: CTRL.rule, backgroundColor: CTRL.bg }}>
        <S.StackX5>
          <S.InlineX5Between style={{ width: '100%', alignItems: 'flex-end' }}>
            <S.StackX1>
              <S.TypeTiny style={{ color: CTRL.inkDimmer }} numberOfLines={1}>
                LOCAL PHASE
              </S.TypeTiny>
              <S.Code style={{ color: CTRL.accentHot, fontSize: 22, lineHeight: 24, letterSpacing: 1.8 }} numberOfLines={1}>
                {phaseLabel(parts.hour)}
              </S.Code>
            </S.StackX1>
            <S.TypeTiny style={{ color: CTRL.inkDimmer }} numberOfLines={1}>
              {remainingHours}H {pad2(remainingMinutes)}M LEFT TODAY
            </S.TypeTiny>
          </S.InlineX5Between>
          <HourTicks hour={parts.hour} />
          <S.StackX4>
            <ProgressLine label="DAY" value={percent(parts.dayProgress)} progress={parts.dayProgress} tone={CTRL.accentHot} />
            <ProgressLine label="WEEK" value={percent(parts.weekProgress)} progress={parts.weekProgress} tone={CTRL.blue} />
            <ProgressLine label="YEAR" value={`${parts.year} / ${percent(parts.yearProgress)}`} progress={parts.yearProgress} tone={CTRL.ok} />
          </S.StackX4>
        </S.StackX5>
      </S.Surface>
    </TimeShell>
  );
}

function secondTone(index: number, second: number): { color: string; opacity: number; height: number } {
  const age = (second - index + 60) % 60;
  if (age === 0) return { color: CTRL.accentHot, opacity: 1, height: 16 };
  if (age <= 5) return { color: CTRL.accent, opacity: 0.94 - age * 0.08, height: 12 };
  if (index < second) return { color: CTRL.ok, opacity: 0.5, height: 8 };
  return { color: CTRL.bg, opacity: 0.45, height: 6 };
}

export function SecondLoom(props: TimeInstrumentProps) {
  const now = useClockNow(props.now);
  const parts = getTimeParts(now);

  return (
    <TimeShell eyebrow="TIME / SECONDS" title="Second Loom" right={parts.time} width={props.width}>
      <S.Surface style={{ borderWidth: 1, borderColor: CTRL.rule, backgroundColor: CTRL.bg }}>
        <S.StackX4>
          <S.InlineX5Between style={{ width: '100%', alignItems: 'flex-end' }}>
            <S.Code style={{ color: CTRL.ink, fontSize: 28, lineHeight: 30, letterSpacing: 2 }} numberOfLines={1}>
              {pad2(parts.second)}
            </S.Code>
            <S.TypeTiny style={{ color: CTRL.inkDimmer }} numberOfLines={1}>
              60 CELL SWEEP
            </S.TypeTiny>
          </S.InlineX5Between>
          <S.StackX2>
            {Array.from({ length: 6 }).map((_, row) => (
              <S.InlineX2 key={`second-row-${row}`} style={{ justifyContent: 'center' }}>
                {Array.from({ length: 10 }).map((__, col) => {
                  const index = row * 10 + col;
                  const tone = secondTone(index, parts.second);
                  return (
                    <S.DotSm
                      key={`second-${index}`}
                      style={{
                        width: 28,
                        height: tone.height,
                        borderRadius: 3,
                        backgroundColor: tone.color,
                        borderWidth: 1,
                        borderColor: index === parts.second ? CTRL.accentHot : CTRL.rule,
                        opacity: tone.opacity,
                      }}
                    />
                  );
                })}
              </S.InlineX2>
            ))}
          </S.StackX2>
        </S.StackX4>
      </S.Surface>
    </TimeShell>
  );
}

