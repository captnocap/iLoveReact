// physics_shim.cpp — Box2D C wrapper
//
// Supports both Box2D 2.x (Linux) and Box2D 3.x (macOS/new installs).
// Compile: via Zig build system as a C++ source file.

#include "physics_shim.h"

// Detect Box2D version: v3 has box2d/math_functions.h, v2 does not
#if __has_include(<box2d/math_functions.h>)
#define BOX2D_V3 1
#else
#define BOX2D_V3 0
#endif

#if BOX2D_V3

// ═══════════════════════════════════════════════════════════════════
// Box2D 3.x — pure C API, value-type IDs
// ═══════════════════════════════════════════════════════════════════

#include <box2d/box2d.h>
#include <box2d/math_functions.h>
#include <stdlib.h>
#include <string.h>

// Box2D 3 uses small value-type IDs (8 bytes). We pack them into void*.
// On 64-bit, sizeof(b2BodyId) == 8 == sizeof(void*), so we memcpy.
static_assert(sizeof(b2WorldId) <= sizeof(void*), "b2WorldId too large for void*");
static_assert(sizeof(b2BodyId) <= sizeof(void*), "b2BodyId too large for void*");
static_assert(sizeof(b2ShapeId) <= sizeof(void*), "b2ShapeId too large for void*");
static_assert(sizeof(b2JointId) <= sizeof(void*), "b2JointId too large for void*");

static void* packWorld(b2WorldId id) { void* p = nullptr; memcpy(&p, &id, sizeof(id)); return p; }
static b2WorldId unpackWorld(void* p) { b2WorldId id; memset(&id, 0, sizeof(id)); memcpy(&id, &p, sizeof(id)); return id; }
static void* packBody(b2BodyId id) { void* p = nullptr; memcpy(&p, &id, sizeof(id)); return p; }
static b2BodyId unpackBody(void* p) { b2BodyId id; memset(&id, 0, sizeof(id)); memcpy(&id, &p, sizeof(id)); return id; }
static void* packShape(b2ShapeId id) { void* p = nullptr; memcpy(&p, &id, sizeof(id)); return p; }
// static b2ShapeId unpackShape(void* p) { b2ShapeId id; memset(&id, 0, sizeof(id)); memcpy(&id, &p, sizeof(id)); return id; }
static void* packJoint(b2JointId id) { void* p = nullptr; memcpy(&p, &id, sizeof(id)); return p; }
static b2JointId unpackJoint(void* p) { b2JointId id; memset(&id, 0, sizeof(id)); memcpy(&id, &p, sizeof(id)); return id; }

// ── World ──────────────────────────────────────────────────────

extern "C" PhysWorld phys_world_create(float gravity_x, float gravity_y) {
    b2WorldDef def = b2DefaultWorldDef();
    def.gravity = (b2Vec2){gravity_x, gravity_y};
    return packWorld(b2CreateWorld(&def));
}

extern "C" void phys_world_destroy(PhysWorld world) {
    b2DestroyWorld(unpackWorld(world));
}

extern "C" void phys_world_step(PhysWorld world, float dt, int velocity_iters, int position_iters) {
    (void)velocity_iters; // v3 uses subStepCount instead
    int sub_steps = position_iters > 0 ? position_iters : 4;
    b2World_Step(unpackWorld(world), dt, sub_steps);
}

// ── Body ───────────────────────────────────────────────────────

extern "C" PhysBody phys_body_create(PhysWorld world, int body_type, float x, float y, float angle) {
    b2BodyDef def = b2DefaultBodyDef();
    switch (body_type) {
        case 0: def.type = b2_staticBody; break;
        case 1: def.type = b2_kinematicBody; break;
        case 2: def.type = b2_dynamicBody; break;
        default: def.type = b2_staticBody; break;
    }
    def.position = (b2Vec2){x, y};
    def.rotation = b2MakeRot(angle);
    return packBody(b2CreateBody(unpackWorld(world), &def));
}

extern "C" void phys_body_destroy(PhysWorld world, PhysBody body) {
    (void)world;
    b2DestroyBody(unpackBody(body));
}

extern "C" float phys_body_get_x(PhysBody body) {
    return b2Body_GetPosition(unpackBody(body)).x;
}

extern "C" float phys_body_get_y(PhysBody body) {
    return b2Body_GetPosition(unpackBody(body)).y;
}

extern "C" float phys_body_get_angle(PhysBody body) {
    return b2Rot_GetAngle(b2Body_GetRotation(unpackBody(body)));
}

extern "C" void phys_body_set_position(PhysBody body, float x, float y) {
    b2BodyId id = unpackBody(body);
    b2Body_SetTransform(id, (b2Vec2){x, y}, b2Body_GetRotation(id));
}

extern "C" void phys_body_set_angle(PhysBody body, float angle) {
    b2BodyId id = unpackBody(body);
    b2Body_SetTransform(id, b2Body_GetPosition(id), b2MakeRot(angle));
}

extern "C" void phys_body_set_linear_damping(PhysBody body, float damping) {
    b2Body_SetLinearDamping(unpackBody(body), damping);
}

extern "C" void phys_body_set_angular_damping(PhysBody body, float damping) {
    b2Body_SetAngularDamping(unpackBody(body), damping);
}

extern "C" void phys_body_set_fixed_rotation(PhysBody body, int fixed) {
    b2Body_SetFixedRotation(unpackBody(body), fixed != 0);
}

extern "C" void phys_body_set_bullet(PhysBody body, int bullet) {
    b2Body_SetBullet(unpackBody(body), bullet != 0);
}

extern "C" void phys_body_set_gravity_scale(PhysBody body, float scale) {
    b2Body_SetGravityScale(unpackBody(body), scale);
}

extern "C" void phys_body_apply_force(PhysBody body, float fx, float fy) {
    b2Body_ApplyForceToCenter(unpackBody(body), (b2Vec2){fx, fy}, true);
}

extern "C" void phys_body_apply_impulse(PhysBody body, float ix, float iy) {
    b2Body_ApplyLinearImpulseToCenter(unpackBody(body), (b2Vec2){ix, iy}, true);
}

extern "C" void phys_body_apply_torque(PhysBody body, float torque) {
    b2Body_ApplyTorque(unpackBody(body), torque, true);
}

extern "C" void phys_body_set_linear_velocity(PhysBody body, float vx, float vy) {
    b2Body_SetLinearVelocity(unpackBody(body), (b2Vec2){vx, vy});
}

extern "C" float phys_body_get_linear_velocity_x(PhysBody body) {
    return b2Body_GetLinearVelocity(unpackBody(body)).x;
}

extern "C" float phys_body_get_linear_velocity_y(PhysBody body) {
    return b2Body_GetLinearVelocity(unpackBody(body)).y;
}

// ── Collider (Shape) ───────────────────────────────────────────

// Box2D 3.1.1 moved friction/restitution out of b2ShapeDef into a nested
// b2SurfaceMaterial (def.material.friction); 3.0/3.1.0 kept them as direct
// members. SFINAE picks whichever the installed headers expose — the `int`
// overload (material) is preferred, falling back to the `long` overload
// (direct) when material.friction doesn't exist. Call with a literal 0.
template <typename Def>
static auto setSurface(Def& def, float friction, float restitution, int)
    -> decltype((void)def.material.friction) {
    def.material.friction = friction;
    def.material.restitution = restitution;
}
template <typename Def>
static auto setSurface(Def& def, float friction, float restitution, long)
    -> decltype((void)def.friction) {
    def.friction = friction;
    def.restitution = restitution;
}

extern "C" PhysFixture phys_collider_box(PhysBody body, float half_w, float half_h,
                                          float density, float friction, float restitution) {
    b2ShapeDef def = b2DefaultShapeDef();
    def.density = density;
    setSurface(def, friction, restitution, 0);
    b2Polygon box = b2MakeBox(half_w, half_h);
    return packShape(b2CreatePolygonShape(unpackBody(body), &def, &box));
}

extern "C" PhysFixture phys_collider_circle(PhysBody body, float radius,
                                             float density, float friction, float restitution) {
    b2ShapeDef def = b2DefaultShapeDef();
    def.density = density;
    setSurface(def, friction, restitution, 0);
    b2Circle circle = {{0.0f, 0.0f}, radius};
    return packShape(b2CreateCircleShape(unpackBody(body), &def, &circle));
}

extern "C" void phys_collider_set_sensor(PhysFixture fixture, int is_sensor) {
    // In Box2D 3, sensor is set at creation time via b2ShapeDef.isSensor.
    // There's no runtime setter. This is a no-op for v3 — set isSensor in the ShapeDef.
    (void)fixture;
    (void)is_sensor;
}

// ── Mouse Joint ────────────────────────────────────────────────

// We need to store the world ID alongside each mouse joint so we can create ground bodies.
// Use a simple thread-local to track the last-used world for joint creation.
static b2WorldId g_last_world;
static bool g_last_world_valid = false;
static b2BodyId g_ground_body;
static bool g_ground_body_valid = false;

static b2BodyId getGroundBody(b2WorldId wid) {
    if (g_ground_body_valid && g_last_world_valid &&
        g_last_world.index1 == wid.index1 && g_last_world.generation == wid.generation) {
        return g_ground_body;
    }
    b2BodyDef gd = b2DefaultBodyDef();
    gd.type = b2_staticBody;
    g_ground_body = b2CreateBody(wid, &gd);
    g_ground_body_valid = true;
    g_last_world = wid;
    g_last_world_valid = true;
    return g_ground_body;
}

extern "C" PhysJoint phys_mouse_joint_create(PhysWorld world, PhysBody body,
                                              float target_x, float target_y, float max_force) {
    b2WorldId wid = unpackWorld(world);
    b2BodyId bid = unpackBody(body);
    b2BodyId ground = getGroundBody(wid);
    b2MouseJointDef def = b2DefaultMouseJointDef();
    def.bodyIdA = ground;
    def.bodyIdB = bid;
    def.target = (b2Vec2){target_x, target_y};
    def.maxForce = max_force;
    def.hertz = 5.0f;
    def.dampingRatio = 0.7f;
    return packJoint(b2CreateMouseJoint(wid, &def));
}

extern "C" void phys_mouse_joint_set_target(PhysJoint joint, float x, float y) {
    b2MouseJoint_SetTarget(unpackJoint(joint), (b2Vec2){x, y});
}

extern "C" void phys_mouse_joint_destroy(PhysJoint joint) {
    b2DestroyJoint(unpackJoint(joint));
}

// ── Point Query ────────────────────────────────────────────────

static b2BodyId g_query_result;
static bool g_query_found;

static bool pointQueryCallback(b2ShapeId shapeId, void* context) {
    (void)context;
    b2BodyId bodyId = b2Shape_GetBody(shapeId);
    if (b2Body_GetType(bodyId) == b2_dynamicBody) {
        g_query_result = bodyId;
        g_query_found = true;
        return false; // stop
    }
    return true; // continue
}

extern "C" PhysBody phys_query_point(PhysWorld world, float x, float y) {
    b2WorldId wid = unpackWorld(world);
    float d = 0.1f;
    b2AABB aabb = {{x - d, y - d}, {x + d, y + d}};
    b2QueryFilter filter = b2DefaultQueryFilter();
    g_query_found = false;
    b2World_OverlapAABB(wid, aabb, filter, pointQueryCallback, NULL);
    if (g_query_found) return packBody(g_query_result);
    return NULL;
}

#else // BOX2D_V3 == 0

// ═══════════════════════════════════════════════════════════════════
// Box2D 2.x — C++ API, pointer-based
// ═══════════════════════════════════════════════════════════════════

#include <box2d/b2_world.h>
#include <box2d/b2_body.h>
#include <box2d/b2_fixture.h>
#include <box2d/b2_polygon_shape.h>
#include <box2d/b2_circle_shape.h>
#include <box2d/b2_math.h>
#include <box2d/b2_mouse_joint.h>
#include <box2d/b2_world_callbacks.h>

// ── World ──────────────────────────────────────────────────────

extern "C" PhysWorld phys_world_create(float gravity_x, float gravity_y) {
    b2Vec2 gravity(gravity_x, gravity_y);
    b2World* world = new b2World(gravity);
    return static_cast<void*>(world);
}

extern "C" void phys_world_destroy(PhysWorld world) {
    delete static_cast<b2World*>(world);
}

extern "C" void phys_world_step(PhysWorld world, float dt, int velocity_iters, int position_iters) {
    static_cast<b2World*>(world)->Step(dt, velocity_iters, position_iters);
}

// ── Body ───────────────────────────────────────────────────────

extern "C" PhysBody phys_body_create(PhysWorld world, int body_type, float x, float y, float angle) {
    b2BodyDef def;
    switch (body_type) {
        case 0: def.type = b2_staticBody; break;
        case 1: def.type = b2_kinematicBody; break;
        case 2: def.type = b2_dynamicBody; break;
        default: def.type = b2_staticBody; break;
    }
    def.position.Set(x, y);
    def.angle = angle;
    b2Body* body = static_cast<b2World*>(world)->CreateBody(&def);
    return static_cast<void*>(body);
}

extern "C" void phys_body_destroy(PhysWorld world, PhysBody body) {
    static_cast<b2World*>(world)->DestroyBody(static_cast<b2Body*>(body));
}

extern "C" float phys_body_get_x(PhysBody body) {
    return static_cast<b2Body*>(body)->GetPosition().x;
}

extern "C" float phys_body_get_y(PhysBody body) {
    return static_cast<b2Body*>(body)->GetPosition().y;
}

extern "C" float phys_body_get_angle(PhysBody body) {
    return static_cast<b2Body*>(body)->GetAngle();
}

extern "C" void phys_body_set_position(PhysBody body, float x, float y) {
    b2Body* b = static_cast<b2Body*>(body);
    b->SetTransform(b2Vec2(x, y), b->GetAngle());
}

extern "C" void phys_body_set_angle(PhysBody body, float angle) {
    b2Body* b = static_cast<b2Body*>(body);
    b->SetTransform(b->GetPosition(), angle);
}

extern "C" void phys_body_set_linear_damping(PhysBody body, float damping) {
    static_cast<b2Body*>(body)->SetLinearDamping(damping);
}

extern "C" void phys_body_set_angular_damping(PhysBody body, float damping) {
    static_cast<b2Body*>(body)->SetAngularDamping(damping);
}

extern "C" void phys_body_set_fixed_rotation(PhysBody body, int fixed) {
    static_cast<b2Body*>(body)->SetFixedRotation(fixed != 0);
}

extern "C" void phys_body_set_bullet(PhysBody body, int bullet) {
    static_cast<b2Body*>(body)->SetBullet(bullet != 0);
}

extern "C" void phys_body_set_gravity_scale(PhysBody body, float scale) {
    static_cast<b2Body*>(body)->SetGravityScale(scale);
}

extern "C" void phys_body_apply_force(PhysBody body, float fx, float fy) {
    static_cast<b2Body*>(body)->ApplyForceToCenter(b2Vec2(fx, fy), true);
}

extern "C" void phys_body_apply_impulse(PhysBody body, float ix, float iy) {
    b2Body* b = static_cast<b2Body*>(body);
    b->ApplyLinearImpulse(b2Vec2(ix, iy), b->GetWorldCenter(), true);
}

extern "C" void phys_body_apply_torque(PhysBody body, float torque) {
    static_cast<b2Body*>(body)->ApplyTorque(torque, true);
}

extern "C" void phys_body_set_linear_velocity(PhysBody body, float vx, float vy) {
    static_cast<b2Body*>(body)->SetLinearVelocity(b2Vec2(vx, vy));
}

extern "C" float phys_body_get_linear_velocity_x(PhysBody body) {
    return static_cast<b2Body*>(body)->GetLinearVelocity().x;
}

extern "C" float phys_body_get_linear_velocity_y(PhysBody body) {
    return static_cast<b2Body*>(body)->GetLinearVelocity().y;
}

// ── Collider (Fixture) ─────────────────────────────────────────

extern "C" PhysFixture phys_collider_box(PhysBody body, float half_w, float half_h,
                                          float density, float friction, float restitution) {
    b2PolygonShape shape;
    shape.SetAsBox(half_w, half_h);
    b2FixtureDef def;
    def.shape = &shape;
    def.density = density;
    def.friction = friction;
    def.restitution = restitution;
    return static_cast<void*>(static_cast<b2Body*>(body)->CreateFixture(&def));
}

extern "C" PhysFixture phys_collider_circle(PhysBody body, float radius,
                                             float density, float friction, float restitution) {
    b2CircleShape shape;
    shape.m_radius = radius;
    b2FixtureDef def;
    def.shape = &shape;
    def.density = density;
    def.friction = friction;
    def.restitution = restitution;
    return static_cast<void*>(static_cast<b2Body*>(body)->CreateFixture(&def));
}

extern "C" void phys_collider_set_sensor(PhysFixture fixture, int is_sensor) {
    static_cast<b2Fixture*>(fixture)->SetSensor(is_sensor != 0);
}

// ── Mouse Joint ────────────────────────────────────────────────

extern "C" PhysJoint phys_mouse_joint_create(PhysWorld world, PhysBody body,
                                              float target_x, float target_y, float max_force) {
    b2World* w = static_cast<b2World*>(world);
    b2Body* b = static_cast<b2Body*>(body);
    b2Body* ground = nullptr;
    for (b2Body* bb = w->GetBodyList(); bb; bb = bb->GetNext()) {
        if (bb->GetType() == b2_staticBody) { ground = bb; break; }
    }
    if (!ground) {
        b2BodyDef gd;
        gd.type = b2_staticBody;
        ground = w->CreateBody(&gd);
    }
    b2MouseJointDef jd;
    jd.bodyA = ground;
    jd.bodyB = b;
    jd.target.Set(target_x, target_y);
    jd.maxForce = max_force;
    jd.stiffness = 5.0f;
    jd.damping = 0.7f;
    return static_cast<void*>(w->CreateJoint(&jd));
}

extern "C" void phys_mouse_joint_set_target(PhysJoint joint, float x, float y) {
    static_cast<b2MouseJoint*>(joint)->SetTarget(b2Vec2(x, y));
}

extern "C" void phys_mouse_joint_destroy(PhysJoint joint) {
    b2Joint* j = static_cast<b2Joint*>(joint);
    j->GetBodyA()->GetWorld()->DestroyJoint(j);
}

// ── Point Query ────────────────────────────────────────────────

class PointQueryCallback : public b2QueryCallback {
public:
    b2Vec2 point;
    b2Body* found = nullptr;

    bool ReportFixture(b2Fixture* fixture) override {
        if (fixture->GetBody()->GetType() != b2_dynamicBody) return true;
        if (fixture->TestPoint(point)) {
            found = fixture->GetBody();
            return false;
        }
        return true;
    }
};

extern "C" PhysBody phys_query_point(PhysWorld world, float x, float y) {
    b2World* w = static_cast<b2World*>(world);
    b2AABB aabb;
    float d = 0.1f;
    aabb.lowerBound.Set(x - d, y - d);
    aabb.upperBound.Set(x + d, y + d);
    PointQueryCallback cb;
    cb.point.Set(x, y);
    w->QueryAABB(&cb, aabb);
    return static_cast<void*>(cb.found);
}

#endif // BOX2D_V3
