export function exportExhibition(store) {
  const ex = store.exhibition;
  return {
    id: ex.id,
    name: ex.name,
    startTime: ex.startTime,
    endTime: ex.endTime,
    description: ex.description,
    floors: ex.floors.map(floor => ({
      id: floor.id,
      label: floor.label,
      width: floor.width,
      depth: floor.depth,
      grid: floor.grid,
      booths: floor.booths.map(b => ({
        id: b.id,
        floorId: b.floorId,
        cells: b.cells,
        area: b.area,
        pricePerUnit: b.pricePerUnit,
        totalPrice: b.totalPrice,
        brandName: b.brandName || '',
        contactName: b.contactName || '',
        companyName: b.companyName || '',
        website: b.website || '',
        contactEmail: b.contactEmail || '',
        boothRent: b.boothRent ?? b.totalPrice,
        orientation: b.orientation,
        power: { ...b.power },
        status: b.status
      }))
    })),
    escalatorLinks: (ex.escalatorLinks || []).map(l => ({
      id: l.id,
      floorA: l.floorA, xA: l.xA, zA: l.zA,
      floorB: l.floorB, xB: l.xB, zB: l.zB
    }))
  };
}
