// editors/characters/animPresets.ts — the animation-script preset shelf (P2
// data). Each preset is a GAME_ANIMATION DSL script the route's play button
// runs against the rig + the face (mouth actions drive .hed animations).
// Behavior reference: cart/head_lab/index.tsx ANIM_PRESETS (read, never
// imported). The DSL itself is game/animation's — this is authoring content.

export const DEFAULT_ANIM_SCRIPT = '[0.3,both_arms,lift_and_bend],[0.2,both_fists,clench],[1,both_arms,shake_in_air;1,mouth,yell]';

export const ANIM_PRESETS: Record<string, string> = {
  point: '[0.5,right_arm,point;0.5,right_finger,point]',
  leftPoint: '[0.5,left_arm,point;0.5,left_finger,point]',
  middle: '[0.25,right_fist,clench],[0.75,right_finger,middle]',
  openClose: '[0.25,both_hands,open],[0.25,both_fists,clench]',
  fingerWiggle: '[1,both_fingers,wiggle_loop]',
  fingerCrawl: '[1,both_fingers,crawl_loop]',
  pinch: '[0.35,right_hand,pinch],[0.35,right_hand,open]',
  jazzHands: '[1,both_hands,jazz_loop]',
  wristFlick: '[1,right_wrist,flick_loop]',
  wristRoll: '[1,both_wrists,roll_loop]',
  punch: '[0.16,both_arms,guard],[0.3,right_arm,punch,cross;0.3,right_fist,clench],[0.18,right_arm,reach]',
  jab: '[0.1,both_arms,guard],[0.22,right_arm,punch,jab;0.22,right_fist,clench],[0.12,right_arm,reach]',
  cross: '[0.16,both_arms,guard],[0.3,right_arm,punch,cross;0.3,right_fist,clench],[0.18,right_arm,reach]',
  hook: '[0.16,both_arms,guard],[0.32,right_arm,punch,hook;0.32,right_fist,clench],[0.16,right_arm,reach]',
  uppercut: '[0.16,both_arms,guard],[0.34,right_arm,punch,uppercut;0.34,right_fist,clench],[0.16,right_arm,reach]',
  bodyShot: '[0.16,both_arms,guard],[0.3,right_arm,punch,body;0.3,right_fist,clench],[0.16,right_arm,reach]',
  leftPunch: '[0.16,both_arms,guard],[0.3,left_arm,punch,cross;0.3,left_fist,clench],[0.18,left_arm,reach]',
  guard: '[1,both_arms,guard;1,both_fists,clench]',
  salute: '[0.65,right_arm,salute;0.65,right_hand,open]',
  wave: '[1,right_arm,wave_loop;1,right_wrist,flick_loop]',
  shakeFist: '[1,right_arm,shake_in_air;1,right_fist,clench]',
  kick: '[0.55,right_leg,kick]',
  leftKick: '[0.55,left_leg,kick]',
  stomp: '[1,both_legs,stomp_loop]',
  footTap: '[1,right_foot,tap_loop]',
  dance: '[1,both_arms,swing_loop;1,both_feet,tap_loop;1,body,bounce_loop;1,head,nod_loop]',
  nodTalk: '[1,head,nod_loop;1,mouth,talk]',
  yellPunch: '[0.2,both_arms,guard],[0.35,right_arm,punch;0.35,right_fist,clench;0.35,mouth,yell]',
  faceGrab: '[0.22,right_arm,reach;0.22,right_hand,open;0.22,face_grab,target],[0.45,right_arm,punch;0.45,right_hand,grip;0.45,mouth,yell]',
  crouch: '[1,body,crouch]',
  sit: '[1,body,sit]',
  lay: '[1,body,lay]',
};
