import { loadBlueprintFile } from '../blueprint/load';
import { blueprintSchema, formatIssuePath } from '../blueprint/schema';
import { writeErr, writeOut } from '../output';
import type { Command } from './command';

export class ValidateCommand implements Command {
  readonly name = 'validate';
  readonly summary = 'Validate a <module>.blueprint.json file against the blueprint schema.';

  run(args: readonly string[]): number {
    const filePath = args[0];

    if (filePath === undefined) {
      writeErr('Missing <blueprint> argument.');
      writeErr('Usage: orangcode validate <path/to/module.blueprint.json>');
      return 1;
    }

    const data = loadBlueprintFile(filePath);
    const result = blueprintSchema.safeParse(data);

    if (result.success) {
      writeOut(`"${filePath}" is a valid blueprint (module "${result.data.module.name}").`);
      return 0;
    }

    const issues = result.error.issues;
    writeErr(`"${filePath}" is not a valid blueprint — ${issues.length} error(s):`);

    for (const issue of issues) {
      writeErr(`  - ${formatIssuePath(issue.path)}: ${issue.message}`);
    }

    writeErr('Fix the issues above, then run the validation again.');
    return 1;
  }
}
