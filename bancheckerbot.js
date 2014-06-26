/* jshint node: true, devel: true */

'use strict';

var soontm = require('soontm');
var ffi = require('ffi');
var config = require('./config');

var VERSION = '0.15.0';

// NOTE: This has to be declared here because we modify the config and we don't
//       want the declaration to be hoisted.
var client;

config.realname += ' v' + VERSION;

var libc = ffi.Library('libc', {
    'fnmatch': ['int', ['string', 'string', 'int']]
});

var state = {
    'queue': [],
    'burst': true
};

function queue(command) {
    state.queue.push({
        'command': command,
        'args': Array.prototype.slice.call(arguments, 1)
    });
}

function fnmatch(pattern, string) {
    return !libc.fnmatch(pattern, string, (1 << 1) | (1 << 4));
}

client = new soontm.Client(config);

client.raw.on('367', function (line) {
    var banmask = line.args[2];

    /* DEBUG BEGIN */
    console.log(state.searchHostmask, banmask);
    /* DEBUG END */

    if (fnmatch(state.searchHostmask, banmask) ||
            fnmatch(banmask.replace(/\$#\S*$/, ''), state.searchHostmask) ||
            soontm.toLowerCase(banmask.replace(/\$#\S*$/, '')) === '$a:' + state.searchAccount) {
        queue('privmsg', state.sourceChannel, banmask);
        state.ok = true;
    }
});

client.raw.on('368', function () {
    if (!state.ok) {
        queue('privmsg', state.sourceChannel, 'Couldn\'t find anything matching ' + state.searchHostmask);
    }

    state.ok = false;
});

client.raw.on('728', function (line) {
    var banmask = line.args[3];

    /* DEBUG BEGIN */
    console.log(state.searchHostmask, banmask);
    /* DEBUG END */

    if (fnmatch(state.searchHostmask, banmask) ||
            fnmatch(banmask.replace(/\$#\S*$/, ''), state.searchHostmask) ||
            soontm.toLowerCase(banmask.replace(/\$#\S*$/, '')) === '$a:' + state.searchAccount) {
        queue('privmsg', state.sourceChannel, banmask);
        state.ok = true;
    }
});

client.raw.on('729', function () {
    if (!state.ok) {
        queue('privmsg', state.sourceChannel, 'Couldn\'t find anything matching ' + state.searchHostmask);
    }

    state.ok = false;
});

client.on('privmsg', function (nick, target, message, line) {
    if (message.indexOf(config.prefix) !== 0) {
        return;
    }

    var args = message.split(' ');
    var command = args[0].slice(1);
    args = args.slice(1);

    if (config.admins.indexOf(line.host) === -1 && command !== 'ping') {
        queue('notice', nick, 'Access denied.');
        return;
    }

    state.sourceChannel = target;

    switch (command) {
    case 'search':
        if (args.length !== 3) {
            break;
        }

        state.mode = args[0];
        state.targetChannel = args[1];

        if (/[!@*?]/.test(args[2])) {
            state.searchHostmask = args[2];
            queue('send', 'MODE ' + state.targetChannel + ' ' + state.mode);
        } else {
            queue('send', 'WHOIS ' + args[2]);
        }

        state.ok = false;

        break;
    case 'join':
        queue('join', args[0]);
        break;
    case 'part':
        queue('part', args[0]);
        break;
    case 'ping':
        client.privmsg(target, nick + ': pong');
        break;
    case 'clearq':
        state.queue = [{
            'command': 'privmsg',
            'args': [target, 'Send queue cleared.']
        }];

        break;
    case 'version':
        queue('privmsg', target, 'bancheckerbot v' + VERSION + ' by fwilson (Fox C. Wilson)');
        queue('privmsg', target, 'Written in node.js using the soontm IRC library');
        queue('privmsg', target, 'Contributors: UltimateNate, nyuszika7h');

        break;
    case 'help':
    case 'commands':
        queue('privmsg', target, 'Commands: !search, !join, !part, !ping, !clearq, !version');
        break;
    }
});

client.raw.on('311', function (line) {
    state.searchHostmask = soontm.toLowerCase(line.args[1]) +
        '!' + line.args[2].toLowerCase() +
        '@' + line.args[3].toLowerCase();
});

client.raw.on('330', function (line) {
    state.searchAccount = soontm.toLowerCase(line.args[2]);
});

client.raw.on('318', function () {
    state.ok = false;
    queue('send', 'MODE ' + state.targetChannel + ' ' + state.mode);
});

setInterval(function processQueue() {
    var line;

    if (state.queue.length) {
        if (state.burst) {
            state.queue.slice(0, 4).forEach(function (item) {
                client[item.command].apply(null, item.args);
            });

            state.queue = state.queue.slice(4);
            state.burst = false;
        } else {
            line = state.queue.shift();
            client[line.command].apply(null, line.args);
        }
    } else {
        state.burst = true;
    }
}, 1000);
