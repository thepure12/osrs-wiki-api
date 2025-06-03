// crafting.get.ts
import { JSDOM } from 'jsdom';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Define an interface for the parsed table row data with camelCase naming
interface CraftingAction {
  output: {
    id: number;
    name: string;
  };
  level: string;
  xp: number;
  needed: number;
  materials: Array<{
    id: number;
    name: string;
    quantity: number;
  }>;
  inputCost: number;
  outputPrice: number;
  profitLoss: number;
  gpPerXp: number;
  members: boolean;
  costPerCraft: number;
  tool: {
    id: number;
    name: string;
  } | null;
}

// --- Load the item name to ID map once when the server starts ---
let ITEM_NAMES_TO_IDS: Record<string, number> = {};
try {
  const filePath = path.join(process.cwd(), 'public', 'name_to_id.json');
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  ITEM_NAMES_TO_IDS = JSON.parse(fileContent);
  console.log('name_to_id.json loaded successfully.');
} catch (error) {
  console.error('Failed to load name_to_id.json:', error);
}
// --- End of map loading ---


export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const currentLevel = parseInt(query.current as string) || 1;
  const goalLevel = parseInt(query.goal as string) || 99;

  const baseUrl = "https://oldschool.runescape.wiki/api.php";

  const textParam = `{{Calculator:Skill calc/Template|name=PurePlugins|currentToggle=Level|current=${currentLevel}|goalToggle=Level|goal=${goalLevel}|method=All|dataCriteria=Show All|skill=Crafting}}`;

  const apiParams = {
    action: "parse",
    text: textParam,
    prop: "text|limitreportdata",
    title: "Calculator:Crafting",
    disablelimitreport: "true",
    contentmodel: "wikitext",
    format: "json",
  };

  const queryParams = new URLSearchParams(apiParams as Record<string, string>);
  const url = `${baseUrl}?${queryParams.toString()}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();

    const htmlString = data.parse.text['*'];

    const dom = new JSDOM(htmlString);
    const doc = dom.window.document;

    const table = doc.querySelector('.wikitable.sortable');
    if (!table) {
      console.error("Table not found in the response HTML. Check the API response or selector.");
      return [];
    }

    const rows = Array.from(table.querySelectorAll('tbody tr'));
    const parsedData: CraftingAction[] = [];

    const parseCurrency = (text: string): number => {
      let cleanedText = text.replace(/[^0-9.\-—]/g, '');
      if (cleanedText.includes('—')) return 0;
      if (cleanedText.startsWith('−')) return -parseFloat(cleanedText.substring(1));
      return parseFloat(cleanedText);
    };

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const cells = Array.from(row.querySelectorAll('td'));
      const rowData = {} as CraftingAction;

      // Column 0 & 1: Output Item (Name and ID)
      const outputName = cells[1]?.querySelector('a')?.textContent?.trim() || cells[1]?.textContent?.trim() || '';
      const outputId = ITEM_NAMES_TO_IDS[outputName] || 0;
      rowData.output = {
        id: outputId,
        name: outputName
      };

      // Column 2: Level
      rowData.level = cells[2]?.textContent?.trim() || '0';

      // Column 3: XP
      rowData.xp = parseFloat(cells[3]?.textContent?.trim() || '0');

      // Column 4: # Needed
      rowData.needed = parseInt(cells[4]?.textContent?.trim()?.replace(/,/g, '') || '0');

      // Column 5: Materials (Name, Quantity, and ID)
      const materials: Array<{ id: number; name: string; quantity: number }> = [];
      const materialsCell = cells[5];
      if (materialsCell) {
          const materialSpans = materialsCell.querySelectorAll('span[typeof="mw:File"]');
          materialSpans?.forEach(span => {
            const materialImg = span.querySelector('img');
            const materialLink = span.nextElementSibling as HTMLAnchorElement;
            if (materialImg && materialLink) {
                const cellHTML = materialsCell.innerHTML;
                const materialName = materialLink.textContent?.trim() || '';
                const regex = new RegExp(`(\\d+,?\\d*)\\s*×\\s*<span[^>]*><a[^>]*href="/w/${materialName.replace(/ /g, '_')}"[^>]*><img[^>]*src="${materialImg.src.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}"[^>]*></a></span> <a[^>]*href="/w/${materialName.replace(/ /g, '_')}"[^>]*>${materialName}</a>`);
                const match = cellHTML.match(regex);
                let quantity = 1;

                if (match && match[1]) {
                    quantity = parseInt(match[1].replace(/,/g, ''), 10);
                }

                const materialId = ITEM_NAMES_TO_IDS[materialName] || 0;

                materials.push({
                  id: materialId,
                  name: materialName,
                  quantity: quantity
                });
            }
        });
      }
      rowData.materials = materials;

      // Column 6: Input Cost
      const inputCost = parseCurrency(cells[6]?.textContent || '');
      rowData.inputCost = inputCost;

      // Column 7: Output Price
      rowData.outputPrice = parseCurrency(cells[7]?.textContent || '');

      // Column 8: Profit/Loss
      rowData.profitLoss = parseCurrency(cells[8]?.textContent || '');

      // Column 9: GP/XP
      rowData.gpPerXp = parseCurrency(cells[9]?.textContent || '');

      // Column 10: Members (boolean)
      rowData.members = !!cells[10]?.querySelector('img[src*="Member_icon.png"]');

      // costPerCraft calculation
      rowData.costPerCraft = rowData.needed > 0 ? rowData.inputCost / rowData.needed : 0;

      // Determine the tool needed (now with ID and Name), with new mould logic
      let toolNeeded: { id: number; name: string; } | null = null;
      const materialsUsed = rowData.materials.map(m => m.name.toLowerCase());
      const outputItemNameLower = rowData.output.name.toLowerCase();

      // Rule: If using a 'bar' and the output is a type of jewellery, use the corresponding mould
      if (materialsUsed.some(name => name.includes('bar'))) {
          if (outputItemNameLower.includes('ring')) {
              const toolName = 'Ring mould'; // Assuming this exists in your name_to_id.json
              toolNeeded = { id: ITEM_NAMES_TO_IDS[toolName] || 0, name: toolName };
          } else if (outputItemNameLower.includes('necklace')) {
              const toolName = 'Necklace mould'; // Assuming this exists in your name_to_id.json
              toolNeeded = { id: ITEM_NAMES_TO_IDS[toolName] || 0, name: toolName };
          } else if (outputItemNameLower.includes('amulet')) {
              const toolName = 'Amulet mould'; // Assuming this exists in your name_to_id.json
              toolNeeded = { id: ITEM_NAMES_TO_IDS[toolName] || 0, name: toolName };
          } else if (outputItemNameLower.includes('bracelet')) {
              const toolName = 'Bracelet mould'; // Assuming this exists in your name_to_id.json
              toolNeeded = { id: ITEM_NAMES_TO_IDS[toolName] || 0, name: toolName };
          }
          // Add more specific jewellery types if needed (e.g., 'tiara', 'holy symbol')
      }

      // Remaining rules (only apply if a specific mould hasn't been determined)
      if (!toolNeeded) {
          if (materialsUsed.some(name => name.includes('leather') || name.includes('fabric'))) {
              const toolName = 'Needle';
              toolNeeded = { id: ITEM_NAMES_TO_IDS[toolName] || 0, name: toolName };
          } else if (materialsUsed.some(name => name.includes('uncut') || name.includes('shell'))) {
              const toolName = 'Chisel';
              toolNeeded = { id: ITEM_NAMES_TO_IDS[toolName] || 0, name: toolName };
          } else if (materialsUsed.some(name => name.includes('nails'))) {
              const toolName = 'Hammer';
              toolNeeded = { id: ITEM_NAMES_TO_IDS[toolName] || 0, name: toolName };
          } else if (materialsUsed.some(name => name.includes('molten glass'))) {
              const toolName = 'Glassblowing pipe';
              toolNeeded = { id: ITEM_NAMES_TO_IDS[toolName] || 0, name: toolName };
          }
      }
      rowData.tool = toolNeeded;

      parsedData.push(rowData);
    }

    // Sort the data by 'gpPerXp' in descending order (highest to lowest)
    parsedData.sort((a, b) => {
      const gpXpA = typeof a.gpPerXp === 'number' ? a.gpXp : 0;
      const gpXpB = typeof b.gpPerXp === 'number' ? b.gpXp : 0;
      return gpXpB - gpXpA;
    });

    return parsedData;

  } catch (error) {
    console.error("Failed to fetch or parse data:", error);
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to retrieve crafting data',
      data: error instanceof Error ? error.message : String(error)
    });
  }
});