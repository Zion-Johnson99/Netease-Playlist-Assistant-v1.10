type TableColumn<Row> = {
  header: string;
  value: (row: Row) => string;
  maxWidth?: number;
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

function hasWideCharacter(value: string): boolean {
  for (const character of value) {
    if (displayWidth(character) > 1) {
      return true;
    }
  }

  return false;
}

function wrapDisplayText(value: string, maxWidth: number): string[] {
  if (maxWidth <= 0 || displayWidth(value) <= maxWidth) {
    return [value];
  }

  const wrapByWidth = (text: string): string[] => {
    const lines: string[] = [];
    let current = "";
    let currentWidth = 0;

    for (const character of text) {
      const characterWidth = displayWidth(character);
      if (currentWidth > 0 && currentWidth + characterWidth > maxWidth) {
        lines.push(current);
        current = "";
        currentWidth = 0;
      }

      current += character;
      currentWidth += characterWidth;
    }

    if (current) {
      lines.push(current);
    }

    return lines;
  };

  const splitByWidth = (
    text: string,
    width: number,
  ): { head: string; tail: string } => {
    let head = "";
    let headWidth = 0;

    for (const character of text) {
      const characterWidth = displayWidth(character);
      if (headWidth + characterWidth > width) {
        return {
          head,
          tail: text.slice(head.length),
        };
      }

      head += character;
      headWidth += characterWidth;
    }

    return { head, tail: "" };
  };

  if (value.includes(" ")) {
    const lines: string[] = [];
    let current = "";

    for (const word of value.split(" ")) {
      const next = current ? `${current} ${word}` : word;
      if (current && displayWidth(next) > maxWidth) {
        const wordWidth = displayWidth(word);
        const remainingWidth = maxWidth - displayWidth(current) - 1;
        const { head, tail } =
          wordWidth > maxWidth ||
          (hasWideCharacter(word) && wordWidth > remainingWidth)
            ? splitByWidth(word, remainingWidth)
            : { head: "", tail: "" };

        if (head) {
          lines.push(`${current} ${head}`);
          const tailLines = wrapByWidth(tail);
          lines.push(...tailLines.slice(0, -1));
          current = tailLines.at(-1) ?? "";
        } else {
          lines.push(...wrapByWidth(current));
          current = word;
        }
      } else {
        current = next;
      }
    }

    if (current) {
      lines.push(...wrapByWidth(current));
    }

    return lines;
  }

  return wrapByWidth(value);
}

export function formatTable<Row>(
  rows: Row[],
  columns: Array<TableColumn<Row>>,
): string[] {
  const widths = columns.map((column) =>
    Math.min(
      column.maxWidth ?? Number.POSITIVE_INFINITY,
      Math.max(
        displayWidth(column.header),
        ...rows.map((row) => displayWidth(column.value(row))),
      ),
    ),
  );

  const formatCells = (cells: string[]): string =>
    cells
      .map((cell, index) => padEndByDisplayWidth(cell, widths[index] ?? 0))
      .join("  ")
      .trimEnd();

  const formatRow = (row: Row): string[] => {
    const wrappedCells = columns.map((column, index) =>
      wrapDisplayText(column.value(row), widths[index] ?? 0),
    );
    const rowHeight = Math.max(...wrappedCells.map((cell) => cell.length));

    return Array.from({ length: rowHeight }, (_, lineIndex) =>
      formatCells(
        wrappedCells.map((cell) => {
          return cell[lineIndex] ?? "";
        }),
      ),
    );
  };

  return [
    formatCells(columns.map((column) => column.header)),
    ...rows.flatMap((row) => formatRow(row)),
  ];
}
