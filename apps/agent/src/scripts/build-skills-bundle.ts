// Regenerates apps/agent/src/hmls/skills-bundle.ts from the canonical
// .skills/<name>/skill.md files. Run after editing a loadable skill:
//   deno task --cwd apps/agent build:skills
// A drift test (load-skills_test.ts) fails CI if this wasn't run.

const SKILLS = ["order", "scheduling"];
const skillsDir = new URL("../../.skills/", import.meta.url);
const outPath = new URL("../hmls/skills-bundle.ts", import.meta.url);

const header =
  `// GENERATED — do not edit by hand. Source of truth: apps/agent/.skills/<name>/skill.md
// Regenerate: deno task --cwd apps/agent build:skills
//
// Skill bodies are vendored as plain string constants because neither runtime
// can read them the easy way: Cloudflare Workers has no filesystem (rules out
// Deno.readTextFile), and Deno's \`with { type: "text" }\` imports need
// --unstable-raw-imports, which Deno Deploy (still running the Fixo app that
// transitively imports this module) does not enable. Plain strings work on
// both. load-skills_test.ts asserts this stays in sync with the .md files.

/** Raw skill.md contents (WITH frontmatter) keyed by skill name. */
export const SKILL_BUNDLE: Record<string, string> = {
`;

const entries: string[] = [];
for (const name of SKILLS) {
  const body = await Deno.readTextFile(new URL(`${name}/skill.md`, skillsDir));
  entries.push(`  ${JSON.stringify(name)}: ${JSON.stringify(body)},`);
}

await Deno.writeTextFile(outPath, header + entries.join("\n") + "\n};\n");
console.log(`Wrote skills-bundle.ts (${SKILLS.length} skills)`);
