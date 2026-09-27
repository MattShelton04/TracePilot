/** Stable review sections, including IDs used by historical captures. */
export const visualSections = [
  { id: "overview", label: "App views" },
  { id: "rich-tools", label: "Rich tools" },
];

export function sectionId(row) {
  if (visualSections.some((section) => section.id === row.group)) return row.group;
  if (row.id?.startsWith("rich-tool-")) return "rich-tools";
  return "overview";
}
