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
      if (!error && result) {
        var response = JSON.parse(result);
        var headers = response.headers;
        var key;

        for (key in headers) {
          if (headers.hasOwnProperty(key)) {
            res.setHeader(key, headers[key]);
          }
        }
        res.send(response.statusCode, response.documentHTML);
      } else {
        next();
      }
    });
  },

  afterPhantomRequest: function(req, res, next) {
    if (!redisOnline || req.prerender.statusCode >= 500) {
      return next();
    }

    var key = req.prerender.url;
    var response = {
      statusCode: req.prerender.statusCode,
      documentHTML: req.prerender.documentHTML,
      headers: req.prerender.prerenderHeaders
    };
    client.set(key, JSON.stringify(response), function(error, reply) {
      // If library set to cache set an expiry on the key.
      if (!error && reply && TTL) {
        client.expire(key, TTL, function(error, didSetExpiry) {
          if (!error && !didSetExpiry) {
            console.warn('Could not set expiry for "' + key + '"');
          }
        });
      }
    });

    next();
  }
};
