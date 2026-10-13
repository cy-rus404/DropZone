/**
 * avatarIcons.js — Shared avatar configuration.
 *
 * Avatars are stored as string IDs (e.g. "Zap") instead of emoji characters.
 * Use <AvatarIcon id="Zap" size={20} /> anywhere an avatar needs to render.
 */
import React from 'react';
import {
  Zap, Star, Heart, Flame, Snowflake, Sun,
  Moon, Cloud, Leaf, Flower2, Feather, Bird,
  Cat, Dog, Fish, Rabbit, Turtle, Bug,
  Rocket, Globe, Cpu, Terminal, Code2, Box,
} from 'lucide-react';

/** Ordered list of avatar options shown in the picker. */
export const AVATAR_LIST = [
  'Zap', 'Star', 'Heart', 'Flame', 'Snowflake', 'Sun',
  'Moon', 'Cloud', 'Leaf', 'Flower2', 'Feather', 'Bird',
  'Cat', 'Dog', 'Fish', 'Rabbit', 'Turtle', 'Bug',
  'Rocket', 'Globe', 'Cpu', 'Terminal', 'Code2', 'Box',
];

export const DEFAULT_AVATAR = 'Zap';

/** Map of ID → lucide component */
const ICON_MAP = {
  Zap, Star, Heart, Flame, Snowflake, Sun,
  Moon, Cloud, Leaf, Flower2, Feather, Bird,
  Cat, Dog, Fish, Rabbit, Turtle, Bug,
  Rocket, Globe, Cpu, Terminal, Code2, Box,
};

/**
 * Renders an avatar icon by ID.
 * Falls back to Zap if the ID is unknown or was an old emoji string.
 */
export function AvatarIcon({ id, size = 18, className = '' }) {
  const Icon = ICON_MAP[id] || Zap;
  return <Icon size={size} strokeWidth={1.8} className={className} />;
}
