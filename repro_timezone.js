
function getHeatmap(localOffsetHours) {
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
    const entry = { day: 0, hour: 10, count: 5 }; // Sunday 10am UTC

    let localHour = entry.hour + localOffsetHours;
    let localDay = entry.day;

    if (localHour >= 24) {
        localHour -= 24;
        localDay = (localDay + 1) % 7;
    } else if (localHour < 0) {
        localHour += 24;
        localDay = (localDay + 6) % 7;
    }

    // Simulate assignment
    // Note: grid[localDay][localHour] works in JS even with float key, but array length/indices don't change
    if (grid[localDay]) {
        if (grid[localDay][localHour] === undefined) {
             grid[localDay][localHour] = 0; // Initialize if undefined
        }
        grid[localDay][localHour] += entry.count;
    }

    console.log(`Offset: ${localOffsetHours}, LocalHour: ${localHour}`);
    console.log(`Grid keys for day ${localDay}:`, Object.keys(grid[localDay]).filter(k => k == localHour));
    console.log(`Value at ${localHour}:`, grid[localDay][localHour]);
    
    // Check if iteration would find it
    let found = false;
    for (let h = 0; h < 24; h++) {
        if (grid[localDay][h] > 0) found = true;
    }
    console.log(`Found in standard iteration (0..23)? ${found}`);
}

// Test India (UTC+5:30) -> Offset +5.5
// Date.getTimezoneOffset() returns -330 minutes.
// -(-330/60) = 5.5
getHeatmap(5.5);
