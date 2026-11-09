// Pixel scales a page when the terminal's cell size changes, to follow text-size zoom.
// A pane opened off screen starts with a placeholder cell size, so its first real
// measurement looks like a huge zoom. A text-size step is small, so a large jump is ignored.

const MAX_ZOOM_STEP = 1.5;

function guardCellZoom(CellZoomFollower) {
  const followed = CellZoomFollower.prototype.ratio;
  CellZoomFollower.prototype.ratio = function ratio(info) {
    const result = followed.call(this, info);
    return result !== null && (result > MAX_ZOOM_STEP || result < 1 / MAX_ZOOM_STEP) ? null : result;
  };
}

// Chromium saves a page's zoom in the surface's data folder, and a file reopens with the
// same folder. Each surface starts at actual size so one bad zoom cannot come back.
function startAtActualSize(contents) {
  const reset = () => {
    if (contents.getURL().startsWith('about:')) return;
    contents.off('did-finish-load', reset);
    contents.setZoomFactor(1);
  };
  contents.on('did-finish-load', reset);
}

module.exports = { MAX_ZOOM_STEP, guardCellZoom, startAtActualSize };
