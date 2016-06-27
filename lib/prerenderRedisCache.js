/**
 * Basic Config Variables
 * redis_url (string) - Redis hostname (defaults to localhost)
 * ttl (int) - TTL on keys set in redis (defaults to 1 day)
 */
var REDIS_URL = process.env.REDISTOGO_URL ||
  process.env.REDISCLOUD_URL ||
  process.env.REDISGREEN_URL ||
  process.env.REDIS_URL ||
  'redis://127.0.0.1:6379';

var url = require('url');
var TTL = process.env.PAGE_TTL || 86400;

// Parse out the connection vars from the env string.
var connection = url.parse(REDIS_URL);
var redis = require('redis');
var client = redis.createClient(connection.port, connection.hostname);
var redisOnline = false;

// Make redis connection
// Select Redis database, parsed from the URL
connection.path = (connection.pathname || '/').slice(1);
connection.database = connection.path.length ? connection.path : '0';
client.select(connection.database);

// Parse out password from the connection string
if (connection.auth) {
  client.auth(connection.auth.split(':')[1]);
}

// Catch all error handler. If redis breaks for any reason it will be reported here.
client.on('error', function(error) {
  console.warn('Redis Cache Error: ' + error);
});

client.on('ready', function() {
  redisOnline = true;
  console.log('Redis Cache Connected');
});

client.on('end', function() {
  redisOnline = false;
  console.warn(
    'Redis Cache Conncetion Closed. Will now bypass redis until it\'s back.'
  );
});

module.exports = {
  beforePhantomRequest: function(req, res, next) {
    if (req.method !== 'GET' || !redisOnline) {
      return next();
    }

    client.get(req.prerender.url, function(error, result) {
      // Page found - return to prerender and 200
      if (!error && result) {
        res.send(200, result);
      } else {
        next();
      }
    });
  },

  afterPhantomRequest: function(req, res, next) {
    if (!redisOnline) {
      return next();
    }

    var key = req.prerender.url;
    // Don't cache anything that didn't result in a 200. This is to stop caching of 3xx/4xx/5xx status codes
    if (req.prerender.statusCode === 200) {
      client.set(key, req.prerender.documentHTML, function(error, reply) {
        // If library set to cache set an expiry on the key.
        if (!error && reply && TTL) {
          client.expire(key, TTL, function(error, didSetExpiry) {
            if (!error && !didSetExpiry) {
              console.warn('Could not set expiry for "' + key + '"');
            }
          });
        }
      });
    }

    next();
  }
};
