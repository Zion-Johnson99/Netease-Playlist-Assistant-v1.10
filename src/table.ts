type TableColumn<Row> = {
  header: string;
  value: (row: Row) => string;
};

function isCombiningCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
  );
}

function isWideCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff)
  );
}

export function displayWidth(value: string): number {
  let width = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (isCombiningCodePoint(codePoint)) {
      continue;
    }
    width += isWideCodePoint(codePoint) ? 2 : 1;
  }
  return width;
}

function padEndByDisplayWidth(value: string, width: number): string {
  return value + " ".repeat(Math.max(0, width - displayWidth(value)));
}

export function formatTable<Row>(
  rows: Row[],
  columns: Array<TableColumn<Row>>,
): string[] {
  const widths = columns.map((column) =>
    Math.max(
      displayWidth(column.header),
      ...rows.map((row) => displayWidth(column.value(row))),
    ),
  );

  const formatCells = (cells: string[]): string =>
    cells
      .map((cell, index) => padEndByDisplayWidth(cell, widths[index] ?? 0))
      .join("  ")
      .trimEnd();

  return [
    formatCells(columns.map((column) => column.header)),
    ...rows.map((row) =>
      formatCells(columns.map((column) => column.value(row))),
    ),
  ];
}
