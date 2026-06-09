import { z } from "zod";

export type Artist = {
  id?: number;
  name: string;
};

export type Song = {
  id: number;
  name: string;
  artists: Artist[];
  album?: string;
};

const FilterSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("language"),
    value: z.string().min(1),
  }),
  z.object({
    type: z.literal("artist"),
    value: z.string().min(1),
  }),
  z.object({
    type: z.literal("semantic"),
    value: z.string().min(1),
  }),
]);

export const CreatePlaylistFromFilterTaskSchema = z.object({
  type: z.literal("create_playlist_from_filter"),
  sourcePlaylistName: z.string().min(1),
  targetPlaylistName: z.string().min(1),
  limit: z.number().int().positive().optional(),
  filter: FilterSchema,
});

export const PlaylistDiffTaskSchema = z.object({
  type: z.literal("playlist_diff"),
  sourcePlaylistName: z.string().min(1),
  targetPlaylistName: z.string().min(1),
});

export const TaskSchema = z.discriminatedUnion("type", [
  CreatePlaylistFromFilterTaskSchema,
  PlaylistDiffTaskSchema,
]);

export type CreatePlaylistFromFilterTask = z.infer<
  typeof CreatePlaylistFromFilterTaskSchema
>;
export type PlaylistDiffTask = z.infer<typeof PlaylistDiffTaskSchema>;
export type PlaylistTask = z.infer<typeof TaskSchema>;

export type MatchedSong = Song & {
  reason: string;
};

export type DiffSong = Song & {
  sourceIndex: number;
  status: "missing";
};

export type PlaylistSummary = {
  id: number;
  name: string;
  trackCount: number;
  userId?: number;
};
