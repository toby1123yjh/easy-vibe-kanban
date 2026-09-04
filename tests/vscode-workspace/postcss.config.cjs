const path = require('node:path');

module.exports = {
  plugins: {
    tailwindcss: {
      config: path.resolve(
        __dirname,
        '../../packages/local-web/tailwind.new.config.js'
      ),
    },
    autoprefixer: {},
  },
};
