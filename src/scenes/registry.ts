import { indoorScene } from './indoor';
import { outdoorScene } from './outdoor';
import { portraitScene } from './portrait';
import { animalScene } from './animal';
import type { SceneDefinition } from './types';

/** Registered scenes; the scene picker and depth diagram read this list. */
export const SCENES: readonly SceneDefinition[] = [
  indoorScene,
  outdoorScene,
  portraitScene,
  animalScene,
];

export function getScene(id: string): SceneDefinition {
  return SCENES.find((scene) => scene.id === id) ?? SCENES[0];
}
