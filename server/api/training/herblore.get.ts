import { JSDOM } from "jsdom";
export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const itemIds: { [key: string]: ItemInfo } = await $fetch(
    "https://www.runelocus.com/addons/idlists/items-search.json"
  );
  const items = await getItems();
  return items.sort((a, b) => {
    if (query.decending && query.decending == "true") {
      const c = a;
      a = b;
      b = c;
    }
    if (query.sort && Object.keys(a).includes("" + query.sort)) {
      return parseInt(a["" + query.sort]) - parseInt(b["" + query.sort]);
    }
    return parseInt(a.level) - parseInt(b.level);
  });

  async function getItems() {
    const wiki_url = `https://oldschool.runescape.wiki/w/Herblore_training`;
    let html: string = await $fetch(wiki_url);
    const dom = new JSDOM(html);
    const data: any[] = [];
    dom.window.document.querySelectorAll("table").forEach((table) => {
      if (
        table.textContent?.includes("XP") //&&
        // table.textContent.includes("Potion")
      ) {
        const headers = getTableHeaders(table);
        table.querySelectorAll("tr").forEach((tr) => {
          const item: { [key: string]: string | {} } = {};
          tr.querySelectorAll("td").forEach((td, i) => {
            const header = headers[i];
            item[header] = getItemInfo(td, header);
          });
          if (Object.keys(item).length !== 0) {
            data.push(item);
          }
        });
      }
    });
    return data;
  }

  function getItemInfo(td: HTMLTableCellElement, header: string) {
    let tdText = td.textContent ?? "";
    if (td.querySelector("a")) {
      const splitPattern = /(?<=\) *\s*(?=[A-Z]))|(?<=[a-z])(?=[A-Z])/;
      const ingredients = tdText.split(splitPattern);
      const itemsInfo = ingredients.map((ingredient) => {
        const amountMatch = ingredient.match(/x(\d+)/);
        const amount = amountMatch ? amountMatch[1] : 1;
        ingredient = ingredient.replace(/x\d+/, "").replace("()", "").trim();
        const found = Object.values(itemIds).find((item) => {
          return (
            !item.duplicate &&
            (header != "potion"
              ? item.name == ingredient
              : item.name.includes(ingredient ?? "%"))
          );
        });
        if (found) {
          return { name: found.name, id: found.id, amount: amount };
        }
        return ingredient;
      });

      // const amountMatch = tdText.match(/x(\d+)/);
      // const amount = amountMatch ? amountMatch[1] : 1;
      // tdText = tdText.replace(/x\d+/, "");
      // const found = Object.values(itemIds).find((item) => {
      //   return (
      //     !item.duplicate &&
      //     (header != "potion"
      //       ? item.name == tdText.trim()
      //       : item.name.includes(tdText.trim() ?? "%"))
      //   );
      // });
      // if (found) {
      //   return { name: found.name, id: found.id, amount: amount };
      // }
      if (itemsInfo.length > 0)
        return itemsInfo.length > 1 ? itemsInfo : itemsInfo[0];
    }
    return tdText.trim();
  }

  // function getIngredientAmount(ingredient: string) {
  //   const amountMatch = tdText.match(/x(\d+)/);
  //     const amount = amountMatch ? amountMatch[1] : 1;
  // }

  function getTableHeaders(table: HTMLTableElement): string[] {
    const headRow = table.querySelector("tr");
    const headers: string[] = [];
    headRow?.querySelectorAll("th").forEach((th) => {
      for (let i = 0; i < th.colSpan; i++) {
        headers.push(
          (th.textContent ?? "")
            ?.trim()
            .replace(/\[.*?\]/g, "")
            .replace(/([a-z])([A-Z])/g, "$1 $2") // Add space
            .toLowerCase()
            .replace(/ /g, "_")
            .toLocaleLowerCase()
        );
      }
    });
    return headers;
  }
});

interface ItemInfo {
  id: number;
  name: string;
  type: string;
  duplicate: boolean;
}
