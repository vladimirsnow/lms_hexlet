import { Minimatch, match, minimatch } from "minimatch";

const result: boolean = minimatch("src/page.tsx", "src/*.tsx");
const matches: string[] = match(["page.tsx", "page.js"], "*.tsx");
const instance = new Minimatch("src/*.tsx");
const instanceResult: boolean = instance.match("src/page.tsx");

void [result, matches, instanceResult];
