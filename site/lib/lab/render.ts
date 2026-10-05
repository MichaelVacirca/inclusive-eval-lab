import type { Scenario } from "./scenarios";

const SLOT = "{{variable}}";

/**
 * Renders the two paired inputs. They are identical outside the variable value.
 * Throws unless the template contains exactly one "{{variable}}" slot.
 */
export function renderInputs(s: Scenario): { a: string; b: string; prefix: string; suffix: string } {
  const parts = s.template.split(SLOT);
  if (parts.length !== 2) {
    throw new Error(`Scenario "${s.id}" template must contain exactly one ${SLOT} slot (found ${parts.length - 1}).`);
  }
  const [prefix, suffix] = parts;
  return {
    a: prefix + s.variable.a.value + suffix,
    b: prefix + s.variable.b.value + suffix,
    prefix,
    suffix,
  };
}
