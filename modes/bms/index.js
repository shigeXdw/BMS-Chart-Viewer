(function () {
  "use strict";

  PlayerModes.register({
    id: "bms",
    name: "BMS / BME / BMSON",
    detect: (file) => /\.(bms|bme|bmson)$/i.test(file.name),
    async parse(file, context) {
      const bmson = /\.bmson$/i.test(file.name);
      const text = bmson ? await file.text() : await context.decodeText(file);
      return bmson
        ? context.parseBmson(text, file.name)
        : context.parseBms(text, file.name);
    }
  });
})();
