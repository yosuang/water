import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const WATER_PROJECT_GITIGNORE_CONTENT = "*\n";

export async function ensureWaterProjectDirectory(projectDir: string): Promise<string> {
  const waterDir = join(resolve(projectDir), ".water");
  await mkdir(waterDir, { recursive: true });
  try {
    await writeFile(join(waterDir, ".gitignore"), WATER_PROJECT_GITIGNORE_CONTENT, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return waterDir;
}
