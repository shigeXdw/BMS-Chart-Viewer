(function () {
  "use strict";

  PlayerModes.register({
    id: "osu",
    name: "osu!mania",
    detect: (file) => /\.osu$/i.test(file.name),
    parse: (file, context) => file.arrayBuffer()
      .then((buffer) => context.parseOsu(new Uint8Array(buffer), file.name))
  });
})();
