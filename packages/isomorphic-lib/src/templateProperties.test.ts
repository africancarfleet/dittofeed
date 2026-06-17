import {
  extractTemplatePropertyKeys,
  extractTemplatePropertyKeysFromString,
} from "./templateProperties";

describe("extractTemplatePropertyKeysFromString", () => {
  it("extracts dot-access keys", () => {
    expect(
      extractTemplatePropertyKeysFromString(
        "Hello {{ properties.title }} and {{ properties.body }}",
      ),
    ).toEqual(["body", "title"]);
  });

  it("uses the top-level key for nested dot access", () => {
    expect(
      extractTemplatePropertyKeysFromString("{{ properties.payload.title }}"),
    ).toEqual(["payload"]);
  });

  it("extracts bracket-access keys with single and double quotes", () => {
    expect(
      extractTemplatePropertyKeysFromString(
        `{{ properties['pushTitle'] }} {{ properties["pushBody"] }}`,
      ),
    ).toEqual(["pushBody", "pushTitle"]);
  });

  it("handles whitespace and filters", () => {
    expect(
      extractTemplatePropertyKeysFromString(
        "{{  properties.greeting  | upcase }} {{properties.name}}",
      ),
    ).toEqual(["greeting", "name"]);
  });

  it("matches references inside liquid tags", () => {
    expect(
      extractTemplatePropertyKeysFromString(
        "{% if properties.showBanner %}hi{% endif %}",
      ),
    ).toEqual(["showBanner"]);
  });

  it("deduplicates repeated keys and sorts results", () => {
    expect(
      extractTemplatePropertyKeysFromString(
        "{{ properties.b }} {{ properties.a }} {{ properties.b }}",
      ),
    ).toEqual(["a", "b"]);
  });

  it("does not match unrelated identifiers", () => {
    expect(
      extractTemplatePropertyKeysFromString(
        "{{ user.properties.email }} {{ customProperties.foo }} {{ user.firstName }}",
      ),
    ).toEqual([]);
  });

  it("returns an empty array when there are no references", () => {
    expect(extractTemplatePropertyKeysFromString("no liquid here")).toEqual([]);
  });
});

describe("extractTemplatePropertyKeys", () => {
  it("scans all string fields of a webhook template definition", () => {
    const definition = {
      type: "Webhook",
      identifierKey: "deviceToken",
      body: JSON.stringify({
        config: {
          url: "https://example.com",
          data: {
            title: "{{ properties.pushTitle }}",
            body: "{{ properties.pushBody }}",
          },
        },
      }),
    };
    expect(extractTemplatePropertyKeys(definition)).toEqual([
      "pushBody",
      "pushTitle",
    ]);
  });

  it("scans nested object/array fields (e.g. email headers)", () => {
    const definition = {
      type: "Email",
      subject: "Hi {{ properties.firstName }}",
      body: "Body referencing {{ properties.cta }}",
      headers: [{ name: "X-Tag", value: "{{ properties.campaign }}" }],
    };
    expect(extractTemplatePropertyKeys(definition)).toEqual([
      "campaign",
      "cta",
      "firstName",
    ]);
  });

  it("returns an empty array for undefined or empty definitions", () => {
    expect(extractTemplatePropertyKeys(undefined)).toEqual([]);
    expect(extractTemplatePropertyKeys(null)).toEqual([]);
    expect(extractTemplatePropertyKeys({})).toEqual([]);
  });
});
