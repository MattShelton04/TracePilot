
const prices = [
  { model: 'claude-sonnet-4.6', inputPerM: 3.00 },
  { model: 'gpt-4.1', inputPerM: 8.00 },
];

function getPrice(modelName) {
    const lower = modelName.toLowerCase();
    // Logic from the code
    return prices.find(p => lower.includes(p.model.toLowerCase()))
      ?? prices.find(p => lower.startsWith(p.model.toLowerCase().split('-').slice(0, 2).join('-')));
}

console.log("Input: claude-sonnet-3.5-new");
console.log("Match:", getPrice("claude-sonnet-3.5-new"));

console.log("Input: gpt-4.1-turbo");
console.log("Match:", getPrice("gpt-4.1-turbo"));
