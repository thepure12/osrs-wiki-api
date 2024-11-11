import { JSDOM } from "jsdom";

interface CellData {
  [key: string]: string | number | {};
}

interface ItemInfo {
  name: string;
  id: number;
}

let items: { [key: string]: ItemInfo };

export default defineEventHandler(async (event) => {
  items = JSON.parse(
    await $fetch("https://www.osrsbox.com/osrsbox-db/items-search.json")
  );
  const query = getQuery(event);
  const wikiUrl = "https://oldschool.runescape.wiki/w";
  const page = decodeURI(getRouterParam(event, "page") ?? "");
  const tableName = decodeURI(getRouterParam(event, "table") ?? "");
  // console.log(`Page: ${page} - Table: ${tableName}`);

  const html: string = await $fetch(`${wikiUrl}/${page}`);
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const header = [...document.querySelectorAll(".mw-headline")].find((el) =>
    el.textContent?.toLowerCase()?.includes(tableName.toLowerCase())
  );
  let next = header?.nextElementSibling;

  while (
    next &&
    (next.tagName != "TABLE" ||
      !next.classList.toString().includes("wikitable"))
  ) {
    next = next.nextElementSibling || next.parentElement;
  }

  // tableToJson(next);
  // return next?.outerHTML ?? html;
  return {
    [tableName]: tableToJson(next).sort((a, b) => {
      if (query.decending && query.decending == "true") {
        const c = a;
        a = b;
        b = c;
      }
      const sort = "" + query.sort;
      if (query.sort && Object.keys(a).includes(sort)) {
        return a[sort] < b[sort] ? -1 : 1;
      }
      return 0;
    }),
  };
});

function tableToJson(table: Element | null | undefined) {
  if (!table) {
    return [];
  }

  const data = [];
  const rows = table.querySelectorAll("tr");
  const headers = getTableHeaders(rows);

  for (let i = getBodyRowIndex(rows); i < rows.length; i++) {
    const row = rows[i];
    const cells = row.querySelectorAll("td");
    const obj: CellData = {};

    headers.forEach((header, index) => {
      const cell = cells[index];
      const a = cell.querySelector("a");
      let cellText = "";
      if (a) {
        const itemName = (a.href ?? "").replaceAll("_", " ").trim();
        cellText = itemName.match(/[^/\\]+$/)?.[0] ?? "";
      } else {
        cellText =
          cells[index]?.textContent
            ?.trim()
            .replaceAll(",", "")
            .replaceAll("−", "-") ?? "";
      }
      obj[header] = isNaN(+cellText) ? cellText : +cellText;
      for (const item of Object.values(items)) {
        if (isNaN(+cellText) && item.name.includes(cellText)) {
          obj[header] = { name: item.name, id: item.id };
        }
      }
    });

    data.push(obj);
  }

  return data;
}

function getTableHeaders(rows: NodeListOf<HTMLTableRowElement>) {
  const thElements: HTMLTableCellElement[] = [];
  rows.forEach((tr, i) => {
    tr.querySelectorAll("th").forEach((th, j) => {
      if (i == 0) {
        for (let x = 0; x < th.colSpan; x++) {
          thElements.push(th);
        }
        return;
      }
      for (const [x, thElement] of thElements.entries()) {
        if (i + 1 <= thElement.rowSpan) {
          // console.log(`Skipping row ${i + 1} ` + th.textContent);
          continue;
        }
        thElements[x + j] = th;
        return;
      }
    });
  });
  // console.log(thElements.map((th) => th.textContent?.trim()));
  return Array.from(thElements).map((th) =>
    formatJsonKey(th.textContent ?? "")
  );
}

function getBodyRowIndex(rows: NodeListOf<HTMLTableRowElement>) {
  for (const [i, row] of rows.entries()) {
    if (!row.querySelector("th")) {
      return i;
    }
  }
  return 0;
}

function formatJsonKey(key: string) {
  return key
    .trim()
    .replace(/\[.*?\]/g, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2") // Add space
    .toLowerCase()
    .replace(/ /g, "_")
    .toLocaleLowerCase();
}
