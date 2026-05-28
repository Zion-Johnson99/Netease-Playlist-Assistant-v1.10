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

export const TaskSchema = z.object({
  sourcePlaylistName: z.string().min(1),
  targetPlaylistName: z.string().min(1),
  limit: z.number().int().positive().optional(),
  filter: z.discriminatedUnion("type", [
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
  ]),
});

export type PlaylistTask = z.infer<typeof TaskSchema>;

export type MatchedSong = Song & {
  reason: string;
};

export type PlaylistSummary = {
  id: number;
  name: string;
  trackCount: number;
  userId?: number;
};
