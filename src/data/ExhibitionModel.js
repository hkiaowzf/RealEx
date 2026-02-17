export const CellType = {
  EMPTY: 'empty',
  CORRIDOR: 'corridor',
  RESTRICTED: 'restricted',
  ENTRANCE: 'entrance',
  BOOTH: 'booth',
  ELEVATOR: 'elevator',
  ESCALATOR: 'escalator',
  LED_SCREEN: 'ledScreen'
};

export const BoothStatus = {
  IDLE: 'idle',
  RESERVED: 'reserved',
  SOLD: 'sold'
};

export const Orientation = {
  STANDARD: 'standard',
  ENTRANCE_FACING: 'entrance-facing',
  MAIN_CORRIDOR: 'main-corridor',
  CORNER: 'corner'
};

export function createExhibition(overrides = {}) {
  return {
    id: overrides.id || crypto.randomUUID(),
    name: overrides.name || 'New Exhibition',
    startTime: overrides.startTime || '',
    endTime: overrides.endTime || '',
    description: overrides.description || '',
    floors: overrides.floors || [],
    escalatorLinks: overrides.escalatorLinks || []
  };
}

export function createFloor(overrides = {}) {
  const width = overrides.width || 12;
  const depth = overrides.depth || 8;
  const grid = [];
  for (let x = 0; x < width; x++) {
    grid[x] = [];
    for (let z = 0; z < depth; z++) {
      grid[x][z] = CellType.EMPTY;
    }
  }
  return {
    id: overrides.id || crypto.randomUUID(),
    label: overrides.label || 'L1',
    width,
    depth,
    grid: overrides.grid || grid,
    booths: overrides.booths || []
  };
}

export function createBooth(overrides = {}) {
  const cells = overrides.cells || [];
  const area = cells.length;
  const pricePerUnit = overrides.pricePerUnit || 0;
  return {
    id: overrides.id || '',
    floorId: overrides.floorId || '',
    cells,
    area,
    pricePerUnit,
    totalPrice: pricePerUnit * area,
    brandName: overrides.brandName || '',
    contactName: overrides.contactName || '',
    companyName: overrides.companyName || '',
    website: overrides.website || '',
    contactEmail: overrides.contactEmail || '',
    boothRent: overrides.boothRent ?? (pricePerUnit * area),
    orientation: overrides.orientation || Orientation.STANDARD,
    power: overrides.power || { type: 'standard', voltage: 220, wattage: 0 },
    status: overrides.status || BoothStatus.IDLE
  };
}
