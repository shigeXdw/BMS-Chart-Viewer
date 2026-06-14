(function () {
  "use strict";

  const modes = [];

  window.PlayerModes = {
    register(mode) {
      if (!mode?.id || typeof mode.detect !== "function" || typeof mode.parse !== "function") {
        throw new Error("Invalid player mode registration");
      }
      modes.push(mode);
    },

    find(file) {
      return modes.find((mode) => mode.detect(file)) || null;
    },

    async parse(file, context) {
      const mode = this.find(file);
      if (!mode) return null;
      const chart = await mode.parse(file, context);
      if (chart) {
        chart.modeId = mode.id;
        chart.mode = mode;
      }
      return chart;
    },

    list() {
      return [...modes];
    }
  };
})();
