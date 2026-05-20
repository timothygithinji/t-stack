import { z } from "zod";

export const User = z.object({
  id: z.string(),
  email: z.email(),
});

export type User = z.infer<typeof User>;
