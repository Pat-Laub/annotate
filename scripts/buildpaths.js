// Where build output lives.
//
// The working copy is $BUILD_ROOT/src, the mirror `qr` rsyncs this repository
// to, so the build root is that tree's parent: the layout is the definition
// rather than a path written down. A tree whose root is not `src` is not the
// working copy -- the Dropbox source tree, say -- and has no build root to
// derive, so this refuses rather than guessing, which is what a test run
// started in Dropbox hits. Quarto's intermediates race the sync daemon there
// and the tests would be reading a render that Dropbox parked beside itself as
// a conflicted copy.
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function derive() {
	if (path.basename(ROOT) !== 'src') {
		throw new Error(`buildpaths: ${ROOT} is not the working copy; render and test under ~/annotate/src (see README), or set BUILD_ROOT`);
	}
	return path.dirname(ROOT);
}

const BUILD_ROOT = process.env.BUILD_ROOT || derive();

module.exports = { BUILD_ROOT };
