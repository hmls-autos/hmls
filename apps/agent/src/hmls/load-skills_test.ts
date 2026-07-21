import { assert, assertEquals } from "@std/assert";
import { LOADABLE_SKILLS, readSkillBody } from "./load-skills.ts";
import { SKILL_BUNDLE } from "./skills-bundle.ts";

// Drift guard: the vendored bundle (used on Cloudflare Workers, which has no
// filesystem) must be a faithful copy of the .md source. If this fails, run:
//   deno task --cwd apps/agent build:skills
Deno.test("skills-bundle matches .skills/*.md", async () => {
  const skillsDir = new URL("../../.skills/", import.meta.url);
  for (const name of LOADABLE_SKILLS) {
    const onDisk = await Deno.readTextFile(new URL(`${name}/skill.md`, skillsDir));
    assertEquals(SKILL_BUNDLE[name], onDisk, `skills-bundle["${name}"] is stale — regenerate`);
  }
});

Deno.test("readSkillBody: returns the order skill body with frontmatter stripped", async () => {
  const body = await readSkillBody("order");
  assert(body !== null, "order skill should exist");
  assert(body!.includes("# Order Skill"), "body should start at the heading");
  assert(!body!.includes("description:"), "YAML frontmatter must be stripped");
});

Deno.test("readSkillBody: returns null for an unknown skill", async () => {
  assertEquals(await readSkillBody("does-not-exist"), null);
});

Deno.test("LOADABLE_SKILLS: v1 is order + scheduling only", () => {
  assertEquals([...LOADABLE_SKILLS], ["order", "scheduling"]);
});
