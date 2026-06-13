import {
  box,
  cylinder8,
  cylinder16,
  hx,
  type Color,
  type Rotation,
  type PropPartSpec,
} from '../../game/kinds/propModels';

export type { Color, PropPartSpec };

export type PropRecipeVec3 = { x: number; y: number; z: number };
export type PropRecipeSize = { width: number; height: number; depth: number };
export type PropRecipeRotation = { pitch: number; yaw: number; roll: number };

export type PropBoxRecipePart = {
  id: string;
  shape: 'box';
  position: PropRecipeVec3;
  size: PropRecipeSize;
  color: Color;
  rotation?: PropRecipeRotation;
};

export type PropCylinderRecipePart = {
  id: string;
  shape: 'cylinder8' | 'cylinder16';
  position: PropRecipeVec3;
  radius: number;
  height: number;
  color: Color;
  rotation?: PropRecipeRotation;
};

export type PropSphereRecipePart = {
  id: string;
  shape: 'sphere';
  position: PropRecipeVec3;
  size: PropRecipeSize;
  color: Color;
  rotation?: PropRecipeRotation;
};

export type PropRecipePart = PropBoxRecipePart | PropCylinderRecipePart | PropSphereRecipePart;

export type PropRecipe = {
  id: string;
  parts: readonly PropRecipePart[];
};

export function recipeColor(hex: string): Color {
  return hx(hex);
}

function recipeVec(v: PropRecipeVec3): readonly [number, number, number] {
  return [v.x, v.y, v.z];
}

function recipeSize(v: PropRecipeSize): readonly [number, number, number] {
  return [v.width, v.height, v.depth];
}

function recipeRotation(v: PropRecipeRotation | undefined): Rotation | undefined {
  return v ? [v.pitch, v.yaw, v.roll] : undefined;
}

export function lowerRecipePart(part: PropRecipePart): PropPartSpec {
  switch (part.shape) {
    case 'box':
      return box(recipeVec(part.position), recipeSize(part.size), part.color, recipeRotation(part.rotation));
    case 'cylinder8':
      return cylinder8(recipeVec(part.position), part.radius, part.height, part.color, recipeRotation(part.rotation));
    case 'cylinder16':
      return cylinder16(recipeVec(part.position), part.radius, part.height, part.color, recipeRotation(part.rotation));
    case 'sphere':
      return {
        shape: 'sphere',
        local: recipeVec(part.position),
        size: recipeSize(part.size),
        color: part.color,
        rotation: recipeRotation(part.rotation),
      };
  }
}

export function lowerPropRecipe(recipe: PropRecipe): PropPartSpec[] {
  return recipe.parts.map(lowerRecipePart);
}
