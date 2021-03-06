/**
Copyright 2018 LGS Innovations

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
**/
(() => {
  'use strict';

  const HTTP_PORT = process.env.HTTP_PORT || 80;
  const HTTPS_PORT = process.env.HTTPS_PORT || 443;

  const ClientCommunication = require('./client-communication');
  const express = require('express');
  const fs = require('fs');
  const Helper = require('./helper');
  const http = require('http');
  const https = require('https');
  const logger = require('./simple-logger');
  const path = require('path');

  class UpgradeServer {
    constructor(bitsBaseDir, bitsDataDir) {
      this._middlewares = {};
      this._httpsOptions = {
        key: fs.readFileSync(path.join(bitsDataDir, 'base/keys/device.pem')),
        cert: fs.readFileSync(path.join(bitsDataDir, 'base/certs/device-server.crt')),
      };
      this.app = express();
      // routing
      logger.debug('Configure routing');
      this.use(function(req, res, next) {
        logger.silly('REQ:\n' + Helper.objectToString(req));
        next();
      });
      this.use('/public', express.static(path.join(__dirname, 'public')));
      this.use(function(req, res, next) {
        logger.debug('URL:' + req.url);
        res.sendFile(path.join(__dirname, 'public/index.html'));
      });
      logger.debug('Configure routing - DONE');
    }

    listen(messageCenter) {
      logger.debug('Web Server Listen');
      return Promise.resolve()
      .then(() => logger.debug('_createHttpServer'))
      .then(() => this._createHttpServer())
      .catch((err) => logger.error('Error creating HTTP server: ', err))
      .then(() => logger.debug('_createHttpsServer'))
      .then(() => this._createHttpsServer({}))
      .catch((err) => logger.error('Error creating HTTPS server: ', err))
      .then(() => {
        this._clientCommunication = new ClientCommunication();
        this._clientCommunication.load(this._httpsServer);
      })
      .then(() => messageCenter.connect(this._httpsServer))
      .then(() => {
        // this promise resolves when our HTTPS server connects
        logger.debug('... waiting for Upgrade Server connection');
        return new Promise((resolve) => {
          this._httpsServer.on('connection', () => {
            logger.debug('Upgrade Server connected');
            resolve('connected');
          });
        });
      })
      .catch((err) => {
        throw Error('listen|' + err);
      });
    }

    close() {
      logger.debug('FUNCTION: UpgradeServer.close()');
      return Promise.resolve()
      .then(() => {
        logger.debug('Closing HTTP Server...');
        const result = this._closeHttpServer();
        logger.debug('Closed HTTPS Server, result is ' + typeof(result) + ': ' + result);
        logger.silly(Helper.objectToString(result));
        return result;
      })
      .then(() => {
        logger.debug('Closing HTTPS Server...');
        const result = this._closeHttpsServer();
        logger.debug('Closed HTTPS Server, result is ' + typeof(result) + ': ' + result);
        logger.silly(Helper.objectToString(result));
        return result;
      })
      .catch((err) => {
        logger.error('ERROR: ' + err);
        throw Error('_close|' + err);
      });
    }

    sendActionName(name) {
      this._clientCommunication.sendActivityName(name);
    }

    sendActionProgress(current, total) {
      this._clientCommunication.sendActivityProgress(current, total);
    }

    sendActionStatus(text) {
      this._clientCommunication.sendActivityStatus(text);
    }

    sendActionReload() {
      ClientCommunication.sendReloadCommand();
    }

    _createHttpsServer() {
      return new Promise((resolve, reject) => {
        // Create and start the HTTPS server
        this._httpsServer = https.createServer(this._httpsOptions, this.app);
        this._httpsServer.setTimeout(1000);
        this._httpsServer.once('error', reject);
        this._httpsServer.listen(HTTPS_PORT, () => resolve(this._httpsServer));
        logger.debug('HTTPS server running at ' + HTTPS_PORT);
      })
      .catch((err) => {
        throw Error('_createHttpsServer|' + err);
      });
    }

    _closeHttpsServer() {
      return new Promise((resolve) => {
        // Terminate the HTTPS server
        logger.debug('Closing HTTPS server');
        this._httpsServer.close(resolve);
        this._httpsServer = undefined;
      });
    }

    _createHttpServer() {
      return new Promise((resolve, reject) => {
        const app = express();
        app.use(function(req, res) {
          logger.debug('Redirecting to HTTPS');
          res.redirect('https://' + req.hostname + ':' + HTTPS_PORT);
        });

        this._httpServer = http.createServer(app);
        this._httpServer.once('error', reject);
        this._httpServer.listen(HTTP_PORT, resolve);
        logger.debug('HTTP server running at ' + HTTP_PORT);
      });
    }

    _closeHttpServer() {
      return new Promise((resolve) => {
        // Terminate the HTTP server
        logger.debug('Closing HTTP server');
        this._httpServer.close(resolve);
        this._httpServer = undefined;
      });
    }

    use(path, middleware) {
      return Promise.resolve()
      .then(() => {
        if (typeof(path) === 'function') {
          return this.use('/', path);
        }
        if (!(path in this._middlewares)) {
          this._middlewares[path] = [];
          if (path === '/') {
            this.app.use(this._getMiddleware(path));
          } else {
            this.app.use(path, this._getMiddleware(path));
          }
        }
        this._middlewares[path].push(middleware);
        return this._middlewares;
      });
    }

    _getMiddleware(path) {
      if (path === undefined) {
        return this._getMiddleware('/');
      }
      if (!(path in this._middlewares)) {
        logger.debug('Promise Reject 1');
        return Promise.reject(function(req, res, next) {});
      }

      return function(req, res, next) {
        this._walkSubstack(this._middlewares[path], req, res, next);
      }.bind(this);
    }

    _walkSubstack(stack, req, res, next) {
      if (typeof(stack) === 'function') {
        stack = [stack];
      }

      const walkStack = function(i, err) {
        if (err) {
          return next(err);
        }

        if (i >= stack.length) {
          return next();
        }

        stack[i](req, res, walkStack.bind(null, i + 1));
      };

      walkStack(0);
    }
  } // UpgradeServer

  module.exports = UpgradeServer;
})();
