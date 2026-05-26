export type GameMode = 'classic' | 'blitz' | 'elimination';

export type ProviderId = 'deezer' | 'spotify';

export interface Song {
  title: string;
  artist: string;
  previewUrl: string;
  coverUrl: string;
}

export interface PlaylistMeta {
  id: string;
  name: string;
  imageUrl: string;
  totalTracks: number;
}

export interface Playlist extends PlaylistMeta {
  provider: ProviderId;
  isBuiltIn: boolean;
  playedIndices: number[];
}

export interface Team {
  id: string;
  index: number;
  name: string;
  score: number;
  completedPlaylists: string[];
}
