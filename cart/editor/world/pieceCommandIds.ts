// Dependency-free identities shared by command declarations and UI projections.
// Keeping these strings out of transaction modules prevents presentation tables
// from importing the world/planner graph merely to name a command.
export const WORLD_PIECE_MOVE_COMMAND_ID = 'world.piece.move';
export const WORLD_PIECE_ROTATE_COMMAND_ID = 'world.piece.rotate';
export const WORLD_PIECE_DELETE_COMMAND_ID = 'world.piece.delete';
export const WORLD_PIECE_MATERIAL_ASSIGN_COMMAND_ID = 'world.piece.material.assign';
export const WORLD_PIECE_MATERIAL_CLEAR_COMMAND_ID = 'world.piece.material.clear';
export const WORLD_PIECE_EDIT_COMMAND_IDS = [
  WORLD_PIECE_MOVE_COMMAND_ID,
  WORLD_PIECE_ROTATE_COMMAND_ID,
  WORLD_PIECE_DELETE_COMMAND_ID,
] as const;
export type WorldPieceEditCommandId = typeof WORLD_PIECE_EDIT_COMMAND_IDS[number];
export const WORLD_PIECE_MATERIAL_COMMAND_IDS = [
  WORLD_PIECE_MATERIAL_ASSIGN_COMMAND_ID,
  WORLD_PIECE_MATERIAL_CLEAR_COMMAND_ID,
] as const;
export type WorldPieceMaterialCommandId = typeof WORLD_PIECE_MATERIAL_COMMAND_IDS[number];
