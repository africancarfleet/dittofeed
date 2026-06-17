/**
 * Utilities for discovering which `properties.*` keys a message template
 * references. Used by the journey node editor to auto-suggest the custom
 * property keys a template expects.
 *
 * The `properties` Liquid variable is populated per journey message node from
 * the node's configured `properties` bag (see MessageNode.properties).
 */

// Matches references to the top-level `properties` Liquid variable, capturing
// the first accessed key. Supports dot access (`properties.foo`,
// `properties.foo.bar`) and bracket access (`properties['foo']`,
// `properties["foo"]`). The leading lookbehind prevents matching unrelated
// identifiers such as `user.properties` or `customProperties`.
const PROPERTY_REFERENCE_REGEX =
  /(?<![\w.])properties\s*(?:\.\s*([a-zA-Z_$][\w$]*)|\[\s*(['"])([^'"]+)\2\s*\])/g;

function collectStrings(value: unknown, acc: string[]): void {
  if (typeof value === "string") {
    acc.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, acc);
    }
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) {
      collectStrings(item, acc);
    }
  }
}

/**
 * Extracts the unique, sorted set of top-level `properties.*` keys referenced
 * within a Liquid source string.
 */
export function extractTemplatePropertyKeysFromString(
  source: string,
): string[] {
  const keys = new Set<string>();
  // Reset lastIndex since the regex is declared with the global flag.
  PROPERTY_REFERENCE_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null = PROPERTY_REFERENCE_REGEX.exec(source);
  while (match !== null) {
    const key = match[1] ?? match[3];
    if (key) {
      keys.add(key);
    }
    match = PROPERTY_REFERENCE_REGEX.exec(source);
  }
  return Array.from(keys).sort();
}

/**
 * Extracts the unique, sorted set of top-level `properties.*` keys referenced
 * anywhere within a message template definition (across all of its Liquid
 * string fields, e.g. webhook body, email subject/body, sms body, push
 * title/body). Accepts any nested object/array shape and is channel-agnostic.
 */
export function extractTemplatePropertyKeys(definition: unknown): string[] {
  const strings: string[] = [];
  collectStrings(definition, strings);
  return extractTemplatePropertyKeysFromString(strings.join("\n"));
}
