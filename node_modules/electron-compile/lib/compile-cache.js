'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _fs = require('fs');

var _fs2 = _interopRequireDefault(_fs);

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

var _zlib = require('zlib');

var _zlib2 = _interopRequireDefault(_zlib);

var _digestForObject = require('./digest-for-object');

var _digestForObject2 = _interopRequireDefault(_digestForObject);

var _promise = require('./promise');

var _mkdirp = require('mkdirp');

var _mkdirp2 = _interopRequireDefault(_mkdirp);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

const d = require('debug')('electron-compile:compile-cache');

/**
 * CompileCache manages getting and setting entries for a single compiler; each
 * in-use compiler will have an instance of this class, usually created via
 * {@link createFromCompiler}.
 *
 * You usually will not use this class directly, it is an implementation class
 * for {@link CompileHost}.
 */
class CompileCache {
  /**
   * Creates an instance, usually used for testing only.
   *
   * @param  {string} cachePath  The root directory to use as a cache path
   *
   * @param  {FileChangedCache} fileChangeCache  A file-change cache that is
   *                                             optionally pre-loaded.
   * @param {string} sourceMapPath The directory to store sourcemap separately if compiler option enabled to emit.
   *                               Default to cachePath if not specified.
   */
  constructor(cachePath, fileChangeCache) {
    let sourceMapPath = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : null;

    this.cachePath = cachePath;
    this.fileChangeCache = fileChangeCache;
    this.sourceMapPath = sourceMapPath || this.cachePath;
  }

  /**
   * Creates a CompileCache from a class compatible with the CompilerBase
   * interface. This method uses the compiler name / version / options to
   * generate a unique directory name for cached results
   *
   * @param  {string} cachePath  The root path to use for the cache, a directory
   *                             representing the hash of the compiler parameters
   *                             will be created here.
   *
   * @param  {CompilerBase} compiler  The compiler to use for version / option
   *                                  information.
   *
   * @param  {FileChangedCache} fileChangeCache  A file-change cache that is
   *                                             optionally pre-loaded.
   *
   * @param  {boolean} readOnlyMode  Don't attempt to create the cache directory.
   *
   * @param {string} sourceMapPath The directory to store sourcemap separately if compiler option enabled to emit.
   *                               Default to cachePath if not specified.
   *
   * @return {CompileCache}  A configured CompileCache instance.
   */
  static createFromCompiler(cachePath, compiler, fileChangeCache) {
    let readOnlyMode = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : false;
    let sourceMapPath = arguments.length > 4 && arguments[4] !== undefined ? arguments[4] : null;

    let newCachePath = null;
    let getCachePath = () => {
      if (newCachePath) return newCachePath;

      const digestObj = {
        name: compiler.name || Object.getPrototypeOf(compiler).constructor.name,
        version: compiler.getCompilerVersion(),
        options: compiler.compilerOptions
      };

      newCachePath = _path2.default.join(cachePath, (0, _digestForObject2.default)(digestObj));

      d(`Path for ${digestObj.name}: ${newCachePath}`);
      d(`Set up with parameters: ${JSON.stringify(digestObj)}`);

      if (!readOnlyMode) _mkdirp2.default.sync(newCachePath);
      return newCachePath;
    };

    let ret = new CompileCache('', fileChangeCache);
    ret.getCachePath = getCachePath;

    const newSourceMapPath = sourceMapPath;
    ret.getSourceMapPath = () => newSourceMapPath || getCachePath();

    return ret;
  }

  /**
   * Returns a file's compiled contents from the cache.
   *
   * @param  {string} filePath  The path to the file. FileChangedCache will look
   *                            up the hash and use that as the key in the cache.
   *
   * @return {Promise<Object>}  An object with all kinds of information
   *
   * @property {Object} hashInfo  The hash information returned from getHashForPath
   * @property {string} code  The source code if the file was a text file
   * @property {Buffer} binaryData  The file if it was a binary file
   * @property {string} mimeType  The MIME type saved in the cache.
   * @property {string[]} dependentFiles  The dependent files returned from
   *                                      compiling the file, if any.
   */
  get(filePath) {
    var _this = this;

    return _asyncToGenerator(function* () {
      d(`Fetching ${filePath} from cache`);
      let hashInfo = yield _this.fileChangeCache.getHashForPath(_path2.default.resolve(filePath));

      let code = null;
      let mimeType = null;
      let binaryData = null;
      let dependentFiles = null;

      let cacheFile = null;
      try {
        cacheFile = _path2.default.join(_this.getCachePath(), hashInfo.hash);
        let result = null;

        if (hashInfo.isFileBinary) {
          d("File is binary, reading out info");
          let info = JSON.parse((yield _promise.pfs.readFile(cacheFile + '.info')));
          mimeType = info.mimeType;
          dependentFiles = info.dependentFiles;

          binaryData = hashInfo.binaryData;
          if (!binaryData) {
            binaryData = yield _promise.pfs.readFile(cacheFile);
            binaryData = yield _promise.pzlib.gunzip(binaryData);
          }
        } else {
          let buf = yield _promise.pfs.readFile(cacheFile);
          let str = (yield _promise.pzlib.gunzip(buf)).toString('utf8');

          result = JSON.parse(str);
          code = result.code;
          mimeType = result.mimeType;
          dependentFiles = result.dependentFiles;
        }
      } catch (e) {
        d(`Failed to read cache for ${filePath}, looked in ${cacheFile}: ${e.message}`);
      }

      return { hashInfo, code, mimeType, binaryData, dependentFiles };
    })();
  }

  /**
   * Saves a compiled result to cache
   *
   * @param  {Object} hashInfo  The hash information returned from getHashForPath
   *
   * @param  {string / Buffer} codeOrBinaryData   The file's contents, either as
   *                                              a string or a Buffer.
   * @param  {string} mimeType  The MIME type returned by the compiler.
   *
   * @param  {string[]} dependentFiles  The list of dependent files returned by
   *                                    the compiler.
   * @return {Promise}  Completion.
   */
  save(hashInfo, codeOrBinaryData, mimeType, dependentFiles) {
    var _this2 = this;

    return _asyncToGenerator(function* () {
      let buf = null;
      let target = _path2.default.join(_this2.getCachePath(), hashInfo.hash);
      d(`Saving to ${target}`);

      if (hashInfo.isFileBinary) {
        buf = yield _promise.pzlib.gzip(codeOrBinaryData);
        yield _promise.pfs.writeFile(target + '.info', JSON.stringify({ mimeType, dependentFiles }), 'utf8');
      } else {
        buf = yield _promise.pzlib.gzip(new Buffer(JSON.stringify({ code: codeOrBinaryData, mimeType, dependentFiles })));
      }

      yield _promise.pfs.writeFile(target, buf);
    })();
  }

  /**
   * Attempts to first get a key via {@link get}, then if it fails, call a method
   * to retrieve the contents, then save the result to cache.
   *
   * The fetcher parameter is expected to have the signature:
   *
   * Promise<Object> fetcher(filePath : string, hashInfo : Object);
   *
   * hashInfo is a value returned from getHashForPath
   * The return value of fetcher must be an Object with the properties:
   *
   * mimeType - the MIME type of the data to save
   * code (optional) - the source code as a string, if file is text
   * binaryData (optional) - the file contents as a Buffer, if file is binary
   * dependentFiles - the dependent files returned by the compiler.
   *
   * @param  {string} filePath  The path to the file. FileChangedCache will look
   *                            up the hash and use that as the key in the cache.
   *
   * @param  {Function} fetcher  A method which conforms to the description above.
   *
   * @return {Promise<Object>}  An Object which has the same fields as the
   *                            {@link get} method return result.
   */
  getOrFetch(filePath, fetcher) {
    var _this3 = this;

    return _asyncToGenerator(function* () {
      let cacheResult = yield _this3.get(filePath);
      let anyDependenciesChanged = yield _this3.haveAnyDependentFilesChanged(cacheResult);

      if ((cacheResult.code || cacheResult.binaryData) && !anyDependenciesChanged) {
        return cacheResult;
      }

      let result = (yield fetcher(filePath, cacheResult.hashInfo)) || { hashInfo: cacheResult.hashInfo };

      if (result.mimeType && !cacheResult.hashInfo.isInNodeModules) {
        d(`Cache miss: saving out info for ${filePath}`);
        yield _this3.save(cacheResult.hashInfo, result.code || result.binaryData, result.mimeType, result.dependentFiles);

        const map = result.sourceMaps;
        if (map) {
          d(`source map for ${filePath} found, saving it to ${_this3.getSourceMapPath()}`);
          yield _this3.saveSourceMap(cacheResult.hashInfo, filePath, map);
        }
      }

      result.hashInfo = cacheResult.hashInfo;
      return result;
    })();
  }

  /**
   * @private Check if any of a file's dependencies have changed
   */
  haveAnyDependentFilesChanged(cacheResult) {
    var _this4 = this;

    return _asyncToGenerator(function* () {
      if (!cacheResult.code || !cacheResult.dependentFiles.length) return false;

      for (let dependentFile of cacheResult.dependentFiles) {
        let hasFileChanged = yield _this4.fileChangeCache.hasFileChanged(dependentFile);
        if (hasFileChanged) {
          return true;
        }

        let dependentFileCacheResult = yield _this4.get(dependentFile);
        if (dependentFileCacheResult.dependentFiles && dependentFileCacheResult.dependentFiles.length) {
          let anySubdependentFilesChanged = yield _this4.haveAnyDependentFilesChanged(dependentFileCacheResult);
          if (anySubdependentFilesChanged) return true;
        }
      }

      return false;
    })();
  }

  getSync(filePath) {
    d(`Fetching ${filePath} from cache`);
    let hashInfo = this.fileChangeCache.getHashForPathSync(_path2.default.resolve(filePath));

    let code = null;
    let mimeType = null;
    let binaryData = null;
    let dependentFiles = null;

    try {
      let cacheFile = _path2.default.join(this.getCachePath(), hashInfo.hash);

      let result = null;
      if (hashInfo.isFileBinary) {
        d("File is binary, reading out info");
        let info = JSON.parse(_fs2.default.readFileSync(cacheFile + '.info'));
        mimeType = info.mimeType;
        dependentFiles = info.dependentFiles;

        binaryData = hashInfo.binaryData;
        if (!binaryData) {
          binaryData = _fs2.default.readFileSync(cacheFile);
          binaryData = _zlib2.default.gunzipSync(binaryData);
        }
      } else {
        let buf = _fs2.default.readFileSync(cacheFile);
        let str = _zlib2.default.gunzipSync(buf).toString('utf8');

        result = JSON.parse(str);
        code = result.code;
        mimeType = result.mimeType;
        dependentFiles = result.dependentFiles;
      }
    } catch (e) {
      d(`Failed to read cache for ${filePath}`);
    }

    return { hashInfo, code, mimeType, binaryData, dependentFiles };
  }

  saveSync(hashInfo, codeOrBinaryData, mimeType, dependentFiles) {
    let buf = null;
    let target = _path2.default.join(this.getCachePath(), hashInfo.hash);
    d(`Saving to ${target}`);

    if (hashInfo.isFileBinary) {
      buf = _zlib2.default.gzipSync(codeOrBinaryData);
      _fs2.default.writeFileSync(target + '.info', JSON.stringify({ mimeType, dependentFiles }), 'utf8');
    } else {
      buf = _zlib2.default.gzipSync(new Buffer(JSON.stringify({ code: codeOrBinaryData, mimeType, dependentFiles })));
    }

    _fs2.default.writeFileSync(target, buf);
  }

  getOrFetchSync(filePath, fetcher) {
    let cacheResult = this.getSync(filePath);
    if (cacheResult.code || cacheResult.binaryData) return cacheResult;

    let result = fetcher(filePath, cacheResult.hashInfo) || { hashInfo: cacheResult.hashInfo };

    if (result.mimeType && !cacheResult.hashInfo.isInNodeModules) {
      d(`Cache miss: saving out info for ${filePath}`);
      this.saveSync(cacheResult.hashInfo, result.code || result.binaryData, result.mimeType, result.dependentFiles);
    }

    const map = result.sourceMaps;
    if (map) {
      d(`source map for ${filePath} found, saving it to ${this.getSourceMapPath()}`);
      this.saveSourceMapSync(cacheResult.hashInfo, filePath, map);
    }

    result.hashInfo = cacheResult.hashInfo;
    return result;
  }

  buildSourceMapTarget(hashInfo, filePath) {
    const fileName = _path2.default.basename(filePath);
    const mapFileName = fileName.replace(_path2.default.extname(fileName), '.js.map');

    const target = _path2.default.join(this.getSourceMapPath(), mapFileName);
    d(`Sourcemap target is: ${target}`);

    return target;
  }

  /**
   * Saves sourcemap string into cache, or specified separate dir
   *
   * @param  {Object} hashInfo  The hash information returned from getHashForPath
   *
   * @param  {string} filePath Path to original file to construct sourcemap file name
    * @param  {string} sourceMap Sourcemap data as string
   *
   * @memberOf CompileCache
   */
  saveSourceMap(hashInfo, filePath, sourceMap) {
    var _this5 = this;

    return _asyncToGenerator(function* () {
      const target = _this5.buildSourceMapTarget(hashInfo, filePath);
      yield _promise.pfs.writeFile(target, sourceMap, 'utf-8');
    })();
  }

  saveSourceMapSync(hashInfo, filePath, sourceMap) {
    const target = this.buildSourceMapTarget(hashInfo, filePath);
    _fs2.default.writeFileSync(target, sourceMap, 'utf-8');
  }

  /**
   * @private
   */
  getCachePath() {
    // NB: This is an evil hack so that createFromCompiler can stomp it
    // at will
    return this.cachePath;
  }

  /**
   * @private
   */
  getSourceMapPath() {
    return this.sourceMapPath;
  }

  /**
   * Returns whether a file should not be compiled. Note that this doesn't
   * necessarily mean it won't end up in the cache, only that its contents are
   * saved verbatim instead of trying to find an appropriate compiler.
   *
   * @param  {Object} hashInfo  The hash information returned from getHashForPath
   *
   * @return {boolean}  True if a file should be ignored
   */
  static shouldPassthrough(hashInfo) {
    return hashInfo.isMinified || hashInfo.isInNodeModules || hashInfo.hasSourceMap || hashInfo.isFileBinary;
  }
}
exports.default = CompileCache;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9jb21waWxlLWNhY2hlLmpzIl0sIm5hbWVzIjpbImQiLCJyZXF1aXJlIiwiQ29tcGlsZUNhY2hlIiwiY29uc3RydWN0b3IiLCJjYWNoZVBhdGgiLCJmaWxlQ2hhbmdlQ2FjaGUiLCJzb3VyY2VNYXBQYXRoIiwiY3JlYXRlRnJvbUNvbXBpbGVyIiwiY29tcGlsZXIiLCJyZWFkT25seU1vZGUiLCJuZXdDYWNoZVBhdGgiLCJnZXRDYWNoZVBhdGgiLCJkaWdlc3RPYmoiLCJuYW1lIiwiT2JqZWN0IiwiZ2V0UHJvdG90eXBlT2YiLCJ2ZXJzaW9uIiwiZ2V0Q29tcGlsZXJWZXJzaW9uIiwib3B0aW9ucyIsImNvbXBpbGVyT3B0aW9ucyIsImpvaW4iLCJKU09OIiwic3RyaW5naWZ5Iiwic3luYyIsInJldCIsIm5ld1NvdXJjZU1hcFBhdGgiLCJnZXRTb3VyY2VNYXBQYXRoIiwiZ2V0IiwiZmlsZVBhdGgiLCJoYXNoSW5mbyIsImdldEhhc2hGb3JQYXRoIiwicmVzb2x2ZSIsImNvZGUiLCJtaW1lVHlwZSIsImJpbmFyeURhdGEiLCJkZXBlbmRlbnRGaWxlcyIsImNhY2hlRmlsZSIsImhhc2giLCJyZXN1bHQiLCJpc0ZpbGVCaW5hcnkiLCJpbmZvIiwicGFyc2UiLCJyZWFkRmlsZSIsImd1bnppcCIsImJ1ZiIsInN0ciIsInRvU3RyaW5nIiwiZSIsIm1lc3NhZ2UiLCJzYXZlIiwiY29kZU9yQmluYXJ5RGF0YSIsInRhcmdldCIsImd6aXAiLCJ3cml0ZUZpbGUiLCJCdWZmZXIiLCJnZXRPckZldGNoIiwiZmV0Y2hlciIsImNhY2hlUmVzdWx0IiwiYW55RGVwZW5kZW5jaWVzQ2hhbmdlZCIsImhhdmVBbnlEZXBlbmRlbnRGaWxlc0NoYW5nZWQiLCJpc0luTm9kZU1vZHVsZXMiLCJtYXAiLCJzb3VyY2VNYXBzIiwic2F2ZVNvdXJjZU1hcCIsImxlbmd0aCIsImRlcGVuZGVudEZpbGUiLCJoYXNGaWxlQ2hhbmdlZCIsImRlcGVuZGVudEZpbGVDYWNoZVJlc3VsdCIsImFueVN1YmRlcGVuZGVudEZpbGVzQ2hhbmdlZCIsImdldFN5bmMiLCJnZXRIYXNoRm9yUGF0aFN5bmMiLCJyZWFkRmlsZVN5bmMiLCJndW56aXBTeW5jIiwic2F2ZVN5bmMiLCJnemlwU3luYyIsIndyaXRlRmlsZVN5bmMiLCJnZXRPckZldGNoU3luYyIsInNhdmVTb3VyY2VNYXBTeW5jIiwiYnVpbGRTb3VyY2VNYXBUYXJnZXQiLCJmaWxlTmFtZSIsImJhc2VuYW1lIiwibWFwRmlsZU5hbWUiLCJyZXBsYWNlIiwiZXh0bmFtZSIsInNvdXJjZU1hcCIsInNob3VsZFBhc3N0aHJvdWdoIiwiaXNNaW5pZmllZCIsImhhc1NvdXJjZU1hcCJdLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBQUE7Ozs7QUFDQTs7OztBQUNBOzs7O0FBQ0E7Ozs7QUFDQTs7QUFDQTs7Ozs7Ozs7QUFFQSxNQUFNQSxJQUFJQyxRQUFRLE9BQVIsRUFBaUIsZ0NBQWpCLENBQVY7O0FBRUE7Ozs7Ozs7O0FBUWUsTUFBTUMsWUFBTixDQUFtQjtBQUNoQzs7Ozs7Ozs7OztBQVVBQyxjQUFZQyxTQUFaLEVBQXVCQyxlQUF2QixFQUE4RDtBQUFBLFFBQXRCQyxhQUFzQix1RUFBTixJQUFNOztBQUM1RCxTQUFLRixTQUFMLEdBQWlCQSxTQUFqQjtBQUNBLFNBQUtDLGVBQUwsR0FBdUJBLGVBQXZCO0FBQ0EsU0FBS0MsYUFBTCxHQUFxQkEsaUJBQWlCLEtBQUtGLFNBQTNDO0FBQ0Q7O0FBRUQ7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFzQkEsU0FBT0csa0JBQVAsQ0FBMEJILFNBQTFCLEVBQXFDSSxRQUFyQyxFQUErQ0gsZUFBL0MsRUFBNEc7QUFBQSxRQUE1Q0ksWUFBNEMsdUVBQTdCLEtBQTZCO0FBQUEsUUFBdEJILGFBQXNCLHVFQUFOLElBQU07O0FBQzFHLFFBQUlJLGVBQWUsSUFBbkI7QUFDQSxRQUFJQyxlQUFlLE1BQU07QUFDdkIsVUFBSUQsWUFBSixFQUFrQixPQUFPQSxZQUFQOztBQUVsQixZQUFNRSxZQUFZO0FBQ2hCQyxjQUFN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QXpDLENBQXBCOztBQUVBLFVBQU01QixTQUFTLGVBQUsvQixJQUFMLENBQVUsS0FBS00sZ0JBQUwsRUFBVixFQUFtQ3VELFdBQW5DLENBQWY7QUFDQWpGLE1BQUcsd0JBQXVCbUQsTUFBTyxFQUFqQzs7QUFFQSxXQUFPQSxNQUFQO0FBQ0Q7O0FBRUQ7Ozs7Ozs7Ozs7QUFXTVksZUFBTixDQUFvQmxDLFFBQXBCLEVBQThCRCxRQUE5QixFQUF3Q3dELFNBQXhDLEVBQW1EO0FBQUE7O0FBQUE7QUFDakQsWUFBTWpDLFNBQVMsT0FBSzJCLG9CQUFMLENBQTBCakQsUUFBMUIsRUFBb0NELFFBQXBDLENBQWY7QUFDQSxZQUFNLGFBQUl5QixTQUFKLENBQWNGLE1BQWQsRUFBc0JpQyxTQUF0QixFQUFpQyxPQUFqQyxDQUFOO0FBRmlEO0FBR2xEOztBQUVEUCxvQkFBa0JoRCxRQUFsQixFQUE0QkQsUUFBNUIsRUFBc0N3RCxTQUF0QyxFQUFpRDtBQUMvQyxVQUFNakMsU0FBUyxLQUFLMkIsb0JBQUwsQ0FBMEJqRCxRQUExQixFQUFvQ0QsUUFBcEMsQ0FBZjtBQUNBLGlCQUFHK0MsYUFBSCxDQUFpQnhCLE1BQWpCLEVBQXlCaUMsU0FBekIsRUFBb0MsT0FBcEM7QUFDRDs7QUFFRDs7O0FBR0F6RSxpQkFBZTtBQUNiO0FBQ0E7QUFDQSxXQUFPLEtBQUtQLFNBQVo7QUFDRDs7QUFFRDs7O0FBR0FzQixxQkFBbUI7QUFDakIsV0FBTyxLQUFLcEIsYUFBWjtBQUNEOztBQUVEOzs7Ozs7Ozs7QUFTQSxTQUFPK0UsaUJBQVAsQ0FBeUJ4RCxRQUF6QixFQUFtQztBQUNqQyxXQUFPQSxTQUFTeUQsVUFBVCxJQUF1QnpELFNBQVMrQixlQUFoQyxJQUFtRC9CLFNBQVMwRCxZQUE1RCxJQUE0RTFELFNBQVNVLFlBQTVGO0FBQ0Q7QUF2VytCO2tCQUFickMsWSIsImZpbGUiOiJjb21waWxlLWNhY2hlLmpzIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IGZzIGZyb20gJ2ZzJztcbmltcG9ydCBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IHpsaWIgZnJvbSAnemxpYic7XG5pbXBvcnQgY3JlYXRlRGlnZXN0Rm9yT2JqZWN0IGZyb20gJy4vZGlnZXN0LWZvci1vYmplY3QnO1xuaW1wb3J0IHtwZnMsIHB6bGlifSBmcm9tICcuL3Byb21pc2UnO1xuaW1wb3J0IG1rZGlycCBmcm9tICdta2RpcnAnO1xuXG5jb25zdCBkID0gcmVxdWlyZSgnZGVidWcnKSgnZWxlY3Ryb24tY29tcGlsZTpjb21waWxlLWNhY2hlJyk7XG5cbi8qKlxuICogQ29tcGlsZUNhY2hlIG1hbmFnZXMgZ2V0dGluZyBhbmQgc2V0dGluZyBlbnRyaWVzIGZvciBhIHNpbmdsZSBjb21waWxlcjsgZWFjaFxuICogaW4tdXNlIGNvbXBpbGVyIHdpbGwgaGF2ZSBhbiBpbnN0YW5jZSBvZiB0aGlzIGNsYXNzLCB1c3VhbGx5IGNyZWF0ZWQgdmlhXG4gKiB7QGxpbmsgY3JlYXRlRnJvbUNvbXBpbGVyfS5cbiAqXG4gKiBZb3UgdXN1YWxseSB3aWxsIG5vdCB1c2UgdGhpcyBjbGFzcyBkaXJlY3RseSwgaXQgaXMgYW4gaW1wbGVtZW50YXRpb24gY2xhc3NcbiAqIGZvciB7QGxpbmsgQ29tcGlsZUhvc3R9LlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBDb21waWxlQ2FjaGUge1xuICAvKipcbiAgICogQ3JlYXRlcyBhbiBpbnN0YW5jZSwgdXN1YWxseSB1c2VkIGZvciB0ZXN0aW5nIG9ubHkuXG4gICAqXG4gICAqIEBwYXJhbSAge3N0cmluZ30gY2FjaGVQYXRoICBUaGUgcm9vdCBkaXJlY3RvcnkgdG8gdXNlIGFzIGEgY2FjaGUgcGF0aFxuICAgKlxuICAgKiBAcGFyYW0gIHtGaWxlQ2hhbmdlZENhY2hlfSBmaWxlQ2hhbmdlQ2FjaGUgIEEgZmlsZS1jaGFuZ2UgY2FjaGUgdGhhdCBpc1xuICAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9wdGlvbmFsbHkgcHJlLWxvYWRlZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNvdXJjZU1hcFBhdGggVGhlIGRpcmVjdG9yeSB0byBzdG9yZSBzb3VyY2VtYXAgc2VwYXJhdGVseSBpZiBjb21waWxlciBvcHRpb24gZW5hYmxlZCB0byBlbWl0LlxuICAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBEZWZhdWx0IHRvIGNhY2hlUGF0aCBpZiBub3Qgc3BlY2lmaWVkLlxuICAgKi9cbiAgY29uc3RydWN0b3IoY2FjaGVQYXRoLCBmaWxlQ2hhbmdlQ2FjaGUsIHNvdXJjZU1hcFBhdGggPSBudWxsKSB7XG4gICAgdGhpcy5jYWNoZVBhdGggPSBjYWNoZVBhdGg7XG4gICAgdGhpcy5maWxlQ2hhbmdlQ2FjaGUgPSBmaWxlQ2hhbmdlQ2FjaGU7XG4gICAgdGhpcy5zb3VyY2VNYXBQYXRoID0gc291cmNlTWFwUGF0aCB8fCB0aGlzLmNhY2hlUGF0aDtcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgQ29tcGlsZUNhY2hlIGZyb20gYSBjbGFzcyBjb21wYXRpYmxlIHdpdGggdGhlIENvbXBpbGVyQmFzZVxuICAgKiBpbnRlcmZhY2UuIFRoaXMgbWV0aG9kIHVzZXMgdGhlIGNvbXBpbGVyIG5hbWUgLyB2ZXJzaW9uIC8gb3B0aW9ucyB0b1xuICAgKiBnZW5lcmF0ZSBhIHVuaXF1ZSBkaXJlY3RvcnkgbmFtZSBmb3IgY2FjaGVkIHJlc3VsdHNcbiAgICpcbiAgICogQHBhcmFtICB7c3RyaW5nfSBjYWNoZVBhdGggIFRoZSByb290IHBhdGggdG8gdXNlIGZvciB0aGUgY2FjaGUsIGEgZGlyZWN0b3J5XG4gICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXByZXNlbnRpbmcgdGhlIGhhc2ggb2YgdGhlIGNvbXBpbGVyIHBhcmFtZXRlcnNcbiAgICogICAgICAgICAgICAgICAgICAgICAgICAgICAgIHdpbGwgYmUgY3JlYXRlZCBoZXJlLlxuICAgKlxuICAgKiBAcGFyYW0gIHtDb21waWxlckJhc2V9IGNvbXBpbGVyICBUaGUgY29tcGlsZXIgdG8gdXNlIGZvciB2ZXJzaW9uIC8gb3B0aW9uXG4gICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZm9ybWF0aW9uLlxuICAgKlxuICAgKiBAcGFyYW0gIHtGaWxlQ2hhbmdlZENhY2hlfSBmaWxlQ2hhbmdlQ2FjaGUgIEEgZmlsZS1jaGFuZ2UgY2FjaGUgdGhhdCBpc1xuICAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9wdGlvbmFsbHkgcHJlLWxvYWRlZC5cbiAgICpcbiAgICogQHBhcmFtICB7Ym9vbGVhbn0gcmVhZE9ubHlNb2RlICBEb24ndCBhdHRlbXB0IHRvIGNyZWF0ZSB0aGUgY2FjaGUgZGlyZWN0b3J5LlxuICAgKlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc291cmNlTWFwUGF0aCBUaGUgZGlyZWN0b3J5IHRvIHN0b3JlIHNvdXJjZW1hcCBzZXBhcmF0ZWx5IGlmIGNvbXBpbGVyIG9wdGlvbiBlbmFibGVkIHRvIGVtaXQuXG4gICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIERlZmF1bHQgdG8gY2FjaGVQYXRoIGlmIG5vdCBzcGVjaWZpZWQuXG4gICAqXG4gICAqIEByZXR1cm4ge0NvbXBpbGVDYWNoZX0gIEEgY29uZmlndXJlZCBDb21waWxlQ2FjaGUgaW5zdGFuY2UuXG4gICAqL1xuICBzdGF0aWMgY3JlYXRlRnJvbUNvbXBpbGVyKGNhY2hlUGF0aCwgY29tcGlsZXIsIGZpbGVDaGFuZ2VDYWNoZSwgcmVhZE9ubHlNb2RlID0gZmFsc2UsIHNvdXJjZU1hcFBhdGggPSBudWxsKSB7XG4gICAgbGV0IG5ld0NhY2hlUGF0aCA9IG51bGw7XG4gICAgbGV0IGdldENhY2hlUGF0aCA9ICgpID0+IHtcbiAgICAgIGlmIChuZXdDYWNoZVBhdGgpIHJldHVybiBuZXdDYWNoZVBhdGg7XG5cbiAgICAgIGNvbnN0IGRpZ2VzdE9iaiA9IHtcbiAgICAgICAgbmFtZTogY29tcGlsZXIubmFtZSB8fCBPYmplY3QuZ2V0UHJvdG90eXBlT2YoY29tcGlsZXIpLmNvbnN0cnVjdG9yLm5hbWUsXG4gICAgICAgIHZlcnNpb246IGNvbXBpbGVyLmdldENvbXBpbGVyVmVyc2lvbigpLFxuICAgICAgICBvcHRpb25zOiBjb21waWxlci5jb21waWxlck9wdGlvbnNcbiAgICAgIH07XG5cbiAgICAgIG5ld0NhY2hlUGF0aCA9IHBhdGguam9pbihjYWNoZVBhdGgsIGNyZWF0ZURpZ2VzdEZvck9iamVjdChkaWdlc3RPYmopKTtcblxuICAgICAgZChgUGF0aCBmb3IgJHtkaWdlc3RPYmoubmFtZX06ICR7bmV3Q2FjaGVQYXRofWApO1xuICAgICAgZChgU2V0IHVwIHdpdGggcGFyYW1ldGVyczogJHtKU09OLnN0cmluZ2lmeShkaWdlc3RPYmopfWApO1xuXG4gICAgICBpZiAoIXJlYWRPbmx5TW9kZSkgbWtkaXJwLnN5bmMobmV3Q2FjaGVQYXRoKTtcbiAgICAgIHJldHVybiBuZXdDYWNoZVBhdGg7XG4gICAgfTtcblxuICAgIGxldCByZXQgPSBuZXcgQ29tcGlsZUNhY2hlKCcnLCBmaWxlQ2hhbmdlQ2FjaGUpO1xuICAgIHJldC5nZXRDYWNoZVBhdGggPSBnZXRDYWNoZVBhdGg7XG5cbiAgICBjb25zdCBuZXdTb3VyY2VNYXBQYXRoID0gc291cmNlTWFwUGF0aDtcbiAgICByZXQuZ2V0U291cmNlTWFwUGF0aCA9ICgpID0+IG5ld1NvdXJjZU1hcFBhdGggfHwgZ2V0Q2FjaGVQYXRoKCk7XG5cbiAgICByZXR1cm4gcmV0O1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYSBmaWxlJ3MgY29tcGlsZWQgY29udGVudHMgZnJvbSB0aGUgY2FjaGUuXG4gICAqXG4gICAqIEBwYXJhbSAge3N0cmluZ30gZmlsZVBhdGggIFRoZSBwYXRoIHRvIHRoZSBmaWxlLiBGaWxlQ2hhbmdlZENhY2hlIHdpbGwgbG9va1xuICAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICB1cCB0aGUgaGFzaCBhbmQgdXNlIHRoYXQgYXMgdGhlIGtleSBpbiB0aGUgY2FjaGUuXG4gICAqXG4gICAqIEByZXR1cm4ge1Byb21pc2U8T2JqZWN0Pn0gIEFuIG9iamVjdCB3aXRoIGFsbCBraW5kcyBvZiBpbmZvcm1hdGlvblxuICAgKlxuICAgKiBAcHJvcGVydHkge09iamVjdH0gaGFzaEluZm8gIFRoZSBoYXNoIGluZm9ybWF0aW9uIHJldHVybmVkIGZyb20gZ2V0SGFzaEZvclBhdGhcbiAgICogQHByb3BlcnR5IHtzdHJpbmd9IGNvZGUgIFRoZSBzb3VyY2UgY29kZSBpZiB0aGUgZmlsZSB3YXMgYSB0ZXh0IGZpbGVcbiAgICogQHByb3BlcnR5IHtCdWZmZXJ9IGJpbmFyeURhdGEgIFRoZSBmaWxlIGlmIGl0IHdhcyBhIGJpbmFyeSBmaWxlXG4gICAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBtaW1lVHlwZSAgVGhlIE1JTUUgdHlwZSBzYXZlZCBpbiB0aGUgY2FjaGUuXG4gICAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IGRlcGVuZGVudEZpbGVzICBUaGUgZGVwZW5kZW50IGZpbGVzIHJldHVybmVkIGZyb21cbiAgICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbXBpbGluZyB0aGUgZmlsZSwgaWYgYW55LlxuICAgKi9cbiAgYXN5bmMgZ2V0KGZpbGVQYXRoKSB7XG4gICAgZChgRmV0Y2hpbmcgJHtmaWxlUGF0aH0gZnJvbSBjYWNoZWApO1xuICAgIGxldCBoYXNoSW5mbyA9IGF3YWl0IHRoaXMuZmlsZUNoYW5nZUNhY2hlLmdldEhhc2hGb3JQYXRoKHBhdGgucmVzb2x2ZShmaWxlUGF0aCkpO1xuXG4gICAgbGV0IGNvZGUgPSBudWxsO1xuICAgIGxldCBtaW1lVHlwZSA9IG51bGw7XG4gICAgbGV0IGJpbmFyeURhdGEgPSBudWxsO1xuICAgIGxldCBkZXBlbmRlbnRGaWxlcyA9IG51bGw7XG5cbiAgICBsZXQgY2FjaGVGaWxlID0gbnVsbDtcbiAgICB0cnkge1xuICAgICAgY2FjaGVGaWxlID0gcGF0aC5qb2luKHRoaXMuZ2V0Q2FjaGVQYXRoKCksIGhhc2hJbmZvLmhhc2gpO1xuICAgICAgbGV0IHJlc3VsdCA9IG51bGw7XG5cbiAgICAgIGlmIChoYXNoSW5mby5pc0ZpbGVCaW5hcnkpIHtcbiAgICAgICAgZChcIkZpbGUgaXMgYmluYXJ5LCByZWFkaW5nIG91dCBpbmZvXCIpO1xuICAgICAgICBsZXQgaW5mbyA9IEpTT04ucGFyc2UoYXdhaXQgcGZzLnJlYWRGaWxlKGNhY2hlRmlsZSArICcuaW5mbycpKTtcbiAgICAgICAgbWltZVR5cGUgPSBpbmZvLm1pbWVUeXBlO1xuICAgICAgICBkZXBlbmRlbnRGaWxlcyA9IGluZm8uZGVwZW5kZW50RmlsZXM7XG5cbiAgICAgICAgYmluYXJ5RGF0YSA9IGhhc2hJbmZvLmJpbmFyeURhdGE7XG4gICAgICAgIGlmICghYmluYXJ5RGF0YSkge1xuICAgICAgICAgIGJpbmFyeURhdGEgPSBhd2FpdCBwZnMucmVhZEZpbGUoY2FjaGVGaWxlKTtcbiAgICAgICAgICBiaW5hcnlEYXRhID0gYXdhaXQgcHpsaWIuZ3VuemlwKGJpbmFyeURhdGEpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBsZXQgYnVmID0gYXdhaXQgcGZzLnJlYWRGaWxlKGNhY2hlRmlsZSk7XG4gICAgICAgIGxldCBzdHIgPSAoYXdhaXQgcHpsaWIuZ3VuemlwKGJ1ZikpLnRvU3RyaW5nKCd1dGY4Jyk7XG5cbiAgICAgICAgcmVzdWx0ID0gSlNPTi5wYXJzZShzdHIpO1xuICAgICAgICBjb2RlID0gcmVzdWx0LmNvZGU7XG4gICAgICAgIG1pbWVUeXBlID0gcmVzdWx0Lm1pbWVUeXBlO1xuICAgICAgICBkZXBlbmRlbnRGaWxlcyA9IHJlc3VsdC5kZXBlbmRlbnRGaWxlcztcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBkKGBGYWlsZWQgdG8gcmVhZCBjYWNoZSBmb3IgJHtmaWxlUGF0aH0sIGxvb2tlZCBpbiAke2NhY2hlRmlsZX06ICR7ZS5tZXNzYWdlfWApO1xuICAgIH1cblxuICAgIHJldHVybiB7IGhhc2hJbmZvLCBjb2RlLCBtaW1lVHlwZSwgYmluYXJ5RGF0YSwgZGVwZW5kZW50RmlsZXMgfTtcbiAgfVxuXG5cbiAgLyoqXG4gICAqIFNhdmVzIGEgY29tcGlsZWQgcmVzdWx0IHRvIGNhY2hlXG4gICAqXG4gICAqIEBwYXJhbSAge09iamVjdH0gaGFzaEluZm8gIFRoZSBoYXNoIGluZm9ybWF0aW9uIHJldHVybmVkIGZyb20gZ2V0SGFzaEZvclBhdGhcbiAgICpcbiAgICogQHBhcmFtICB7c3RyaW5nIC8gQnVmZmVyfSBjb2RlT3JCaW5hcnlEYXRhICAgVGhlIGZpbGUncyBjb250ZW50cywgZWl0aGVyIGFzXG4gICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGEgc3RyaW5nIG9yIGEgQnVmZmVyLlxuICAgKiBAcGFyYW0gIHtzdHJpbmd9IG1pbWVUeXBlICBUaGUgTUlNRSB0eXBlIHJldHVybmVkIGJ5IHRoZSBjb21waWxlci5cbiAgICpcbiAgICogQHBhcmFtICB7c3RyaW5nW119IGRlcGVuZGVudEZpbGVzICBUaGUgbGlzdCBvZiBkZXBlbmRlbnQgZmlsZXMgcmV0dXJuZWQgYnlcbiAgICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGUgY29tcGlsZXIuXG4gICAqIEByZXR1cm4ge1Byb21pc2V9ICBDb21wbGV0aW9uLlxuICAgKi9cbiAgYXN5bmMgc2F2ZShoYXNoSW5mbywgY29kZU9yQmluYXJ5RGF0YSwgbWltZVR5cGUsIGRlcGVuZGVudEZpbGVzKSB7XG4gICAgbGV0IGJ1ZiA9IG51bGw7XG4gICAgbGV0IHRhcmdldCA9IHBhdGguam9pbih0aGlzLmdldENhY2hlUGF0aCgpLCBoYXNoSW5mby5oYXNoKTtcbiAgICBkKGBTYXZpbmcgdG8gJHt0YXJnZXR9YCk7XG5cbiAgICBpZiAoaGFzaEluZm8uaXNGaWxlQmluYXJ5KSB7XG4gICAgICBidWYgPSBhd2FpdCBwemxpYi5nemlwKGNvZGVPckJpbmFyeURhdGEpO1xuICAgICAgYXdhaXQgcGZzLndyaXRlRmlsZSh0YXJnZXQgKyAnLmluZm8nLCBKU09OLnN0cmluZ2lmeSh7bWltZVR5cGUsIGRlcGVuZGVudEZpbGVzfSksICd1dGY4Jyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGJ1ZiA9IGF3YWl0IHB6bGliLmd6aXAobmV3IEJ1ZmZlcihKU09OLnN0cmluZ2lmeSh7Y29kZTogY29kZU9yQmluYXJ5RGF0YSwgbWltZVR5cGUsIGRlcGVuZGVudEZpbGVzfSkpKTtcbiAgICB9XG5cbiAgICBhd2FpdCBwZnMud3JpdGVGaWxlKHRhcmdldCwgYnVmKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBdHRlbXB0cyB0byBmaXJzdCBnZXQgYSBrZXkgdmlhIHtAbGluayBnZXR9LCB0aGVuIGlmIGl0IGZhaWxzLCBjYWxsIGEgbWV0aG9kXG4gICAqIHRvIHJldHJpZXZlIHRoZSBjb250ZW50cywgdGhlbiBzYXZlIHRoZSByZXN1bHQgdG8gY2FjaGUuXG4gICAqXG4gICAqIFRoZSBmZXRjaGVyIHBhcmFtZXRlciBpcyBleHBlY3RlZCB0byBoYXZlIHRoZSBzaWduYXR1cmU6XG4gICAqXG4gICAqIFByb21pc2U8T2JqZWN0PiBmZXRjaGVyKGZpbGVQYXRoIDogc3RyaW5nLCBoYXNoSW5mbyA6IE9iamVjdCk7XG4gICAqXG4gICAqIGhhc2hJbmZvIGlzIGEgdmFsdWUgcmV0dXJuZWQgZnJvbSBnZXRIYXNoRm9yUGF0aFxuICAgKiBUaGUgcmV0dXJuIHZhbHVlIG9mIGZldGNoZXIgbXVzdCBiZSBhbiBPYmplY3Qgd2l0aCB0aGUgcHJvcGVydGllczpcbiAgICpcbiAgICogbWltZVR5cGUgLSB0aGUgTUlNRSB0eXBlIG9mIHRoZSBkYXRhIHRvIHNhdmVcbiAgICogY29kZSAob3B0aW9uYWwpIC0gdGhlIHNvdXJjZSBjb2RlIGFzIGEgc3RyaW5nLCBpZiBmaWxlIGlzIHRleHRcbiAgICogYmluYXJ5RGF0YSAob3B0aW9uYWwpIC0gdGhlIGZpbGUgY29udGVudHMgYXMgYSBCdWZmZXIsIGlmIGZpbGUgaXMgYmluYXJ5XG4gICAqIGRlcGVuZGVudEZpbGVzIC0gdGhlIGRlcGVuZGVudCBmaWxlcyByZXR1cm5lZCBieSB0aGUgY29tcGlsZXIuXG4gICAqXG4gICAqIEBwYXJhbSAge3N0cmluZ30gZmlsZVBhdGggIFRoZSBwYXRoIHRvIHRoZSBmaWxlLiBGaWxlQ2hhbmdlZENhY2hlIHdpbGwgbG9va1xuICAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICB1cCB0aGUgaGFzaCBhbmQgdXNlIHRoYXQgYXMgdGhlIGtleSBpbiB0aGUgY2FjaGUuXG4gICAqXG4gICAqIEBwYXJhbSAge0Z1bmN0aW9ufSBmZXRjaGVyICBBIG1ldGhvZCB3aGljaCBjb25mb3JtcyB0byB0aGUgZGVzY3JpcHRpb24gYWJvdmUuXG4gICAqXG4gICAqIEByZXR1cm4ge1Byb21pc2U8T2JqZWN0Pn0gIEFuIE9iamVjdCB3aGljaCBoYXMgdGhlIHNhbWUgZmllbGRzIGFzIHRoZVxuICAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICB7QGxpbmsgZ2V0fSBtZXRob2QgcmV0dXJuIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGdldE9yRmV0Y2goZmlsZVBhdGgsIGZldGNoZXIpIHtcbiAgICBsZXQgY2FjaGVSZXN1bHQgPSBhd2FpdCB0aGlzLmdldChmaWxlUGF0aCk7XG4gICAgbGV0IGFueURlcGVuZGVuY2llc0NoYW5nZWQgPSBhd2FpdCB0aGlzLmhhdmVBbnlEZXBlbmRlbnRGaWxlc0NoYW5nZWQoY2FjaGVSZXN1bHQpO1xuXG4gICAgaWYgKChjYWNoZVJlc3VsdC5jb2RlIHx8IGNhY2hlUmVzdWx0LmJpbmFyeURhdGEpICYmICFhbnlEZXBlbmRlbmNpZXNDaGFuZ2VkKSB7XG4gICAgICByZXR1cm4gY2FjaGVSZXN1bHQ7XG4gICAgfVxuXG4gICAgbGV0IHJlc3VsdCA9IGF3YWl0IGZldGNoZXIoZmlsZVBhdGgsIGNhY2hlUmVzdWx0Lmhhc2hJbmZvKSB8fCB7IGhhc2hJbmZvOiBjYWNoZVJlc3VsdC5oYXNoSW5mbyB9O1xuXG4gICAgaWYgKHJlc3VsdC5taW1lVHlwZSAmJiAhY2FjaGVSZXN1bHQuaGFzaEluZm8uaXNJbk5vZGVNb2R1bGVzKSB7XG4gICAgICBkKGBDYWNoZSBtaXNzOiBzYXZpbmcgb3V0IGluZm8gZm9yICR7ZmlsZVBhdGh9YCk7XG4gICAgICBhd2FpdCB0aGlzLnNhdmUoY2FjaGVSZXN1bHQuaGFzaEluZm8sIHJlc3VsdC5jb2RlIHx8IHJlc3VsdC5iaW5hcnlEYXRhLCByZXN1bHQubWltZVR5cGUsIHJlc3VsdC5kZXBlbmRlbnRGaWxlcyk7XG5cbiAgICAgIGNvbnN0IG1hcCA9IHJlc3VsdC5zb3VyY2VNYXBzO1xuICAgICAgaWYgKG1hcCkge1xuICAgICAgICBkKGBzb3VyY2UgbWFwIGZvciAke2ZpbGVQYXRofSBmb3VuZCwgc2F2aW5nIGl0IHRvICR7dGhpcy5nZXRTb3VyY2VNYXBQYXRoKCl9YCk7XG4gICAgICAgIGF3YWl0IHRoaXMuc2F2ZVNvdXJjZU1hcChjYWNoZVJlc3VsdC5oYXNoSW5mbywgZmlsZVBhdGgsIG1hcCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmVzdWx0Lmhhc2hJbmZvID0gY2FjaGVSZXN1bHQuaGFzaEluZm87XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIC8qKlxuICAgKiBAcHJpdmF0ZSBDaGVjayBpZiBhbnkgb2YgYSBmaWxlJ3MgZGVwZW5kZW5jaWVzIGhhdmUgY2hhbmdlZFxuICAgKi9cbiAgYXN5bmMgaGF2ZUFueURlcGVuZGVudEZpbGVzQ2hhbmdlZChjYWNoZVJlc3VsdCkge1xuICAgIGlmICghY2FjaGVSZXN1bHQuY29kZSB8fCAhY2FjaGVSZXN1bHQuZGVwZW5kZW50RmlsZXMubGVuZ3RoKSByZXR1cm4gZmFsc2U7XG5cbiAgICBmb3IgKGxldCBkZXBlbmRlbnRGaWxlIG9mIGNhY2hlUmVzdWx0LmRlcGVuZGVudEZpbGVzKSB7XG4gICAgICBsZXQgaGFzRmlsZUNoYW5nZWQgPSBhd2FpdCB0aGlzLmZpbGVDaGFuZ2VDYWNoZS5oYXNGaWxlQ2hhbmdlZChkZXBlbmRlbnRGaWxlKTtcbiAgICAgIGlmIChoYXNGaWxlQ2hhbmdlZCkge1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH1cblxuICAgICAgbGV0IGRlcGVuZGVudEZpbGVDYWNoZVJlc3VsdCA9IGF3YWl0IHRoaXMuZ2V0KGRlcGVuZGVudEZpbGUpO1xuICAgICAgaWYgKGRlcGVuZGVudEZpbGVDYWNoZVJlc3VsdC5kZXBlbmRlbnRGaWxlcyAmJiBkZXBlbmRlbnRGaWxlQ2FjaGVSZXN1bHQuZGVwZW5kZW50RmlsZXMubGVuZ3RoKSB7XG4gICAgICAgIGxldCBhbnlTdWJkZXBlbmRlbnRGaWxlc0NoYW5nZWQgPSBhd2FpdCB0aGlzLmhhdmVBbnlEZXBlbmRlbnRGaWxlc0NoYW5nZWQoZGVwZW5kZW50RmlsZUNhY2hlUmVzdWx0KTtcbiAgICAgICAgaWYgKGFueVN1YmRlcGVuZGVudEZpbGVzQ2hhbmdlZCkgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cblxuICBnZXRTeW5jKGZpbGVQYXRoKSB7XG4gICAgZChgRmV0Y2hpbmcgJHtmaWxlUGF0aH0gZnJvbSBjYWNoZWApO1xuICAgIGxldCBoYXNoSW5mbyA9IHRoaXMuZmlsZUNoYW5nZUNhY2hlLmdldEhhc2hGb3JQYXRoU3luYyhwYXRoLnJlc29sdmUoZmlsZVBhdGgpKTtcblxuICAgIGxldCBjb2RlID0gbnVsbDtcbiAgICBsZXQgbWltZVR5cGUgPSBudWxsO1xuICAgIGxldCBiaW5hcnlEYXRhID0gbnVsbDtcbiAgICBsZXQgZGVwZW5kZW50RmlsZXMgPSBudWxsO1xuXG4gICAgdHJ5IHtcbiAgICAgIGxldCBjYWNoZUZpbGUgPSBwYXRoLmpvaW4odGhpcy5nZXRDYWNoZVBhdGgoKSwgaGFzaEluZm8uaGFzaCk7XG5cbiAgICAgIGxldCByZXN1bHQgPSBudWxsO1xuICAgICAgaWYgKGhhc2hJbmZvLmlzRmlsZUJpbmFyeSkge1xuICAgICAgICBkKFwiRmlsZSBpcyBiaW5hcnksIHJlYWRpbmcgb3V0IGluZm9cIik7XG4gICAgICAgIGxldCBpbmZvID0gSlNPTi5wYXJzZShmcy5yZWFkRmlsZVN5bmMoY2FjaGVGaWxlICsgJy5pbmZvJykpO1xuICAgICAgICBtaW1lVHlwZSA9IGluZm8ubWltZVR5cGU7XG4gICAgICAgIGRlcGVuZGVudEZpbGVzID0gaW5mby5kZXBlbmRlbnRGaWxlcztcblxuICAgICAgICBiaW5hcnlEYXRhID0gaGFzaEluZm8uYmluYXJ5RGF0YTtcbiAgICAgICAgaWYgKCFiaW5hcnlEYXRhKSB7XG4gICAgICAgICAgYmluYXJ5RGF0YSA9IGZzLnJlYWRGaWxlU3luYyhjYWNoZUZpbGUpO1xuICAgICAgICAgIGJpbmFyeURhdGEgPSB6bGliLmd1bnppcFN5bmMoYmluYXJ5RGF0YSk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGxldCBidWYgPSBmcy5yZWFkRmlsZVN5bmMoY2FjaGVGaWxlKTtcbiAgICAgICAgbGV0IHN0ciA9ICh6bGliLmd1bnppcFN5bmMoYnVmKSkudG9TdHJpbmcoJ3V0ZjgnKTtcblxuICAgICAgICByZXN1bHQgPSBKU09OLnBhcnNlKHN0cik7XG4gICAgICAgIGNvZGUgPSByZXN1bHQuY29kZTtcbiAgICAgICAgbWltZVR5cGUgPSByZXN1bHQubWltZVR5cGU7XG4gICAgICAgIGRlcGVuZGVudEZpbGVzID0gcmVzdWx0LmRlcGVuZGVudEZpbGVzO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGQoYEZhaWxlZCB0byByZWFkIGNhY2hlIGZvciAke2ZpbGVQYXRofWApO1xuICAgIH1cblxuICAgIHJldHVybiB7IGhhc2hJbmZvLCBjb2RlLCBtaW1lVHlwZSwgYmluYXJ5RGF0YSwgZGVwZW5kZW50RmlsZXMgfTtcbiAgfVxuXG4gIHNhdmVTeW5jKGhhc2hJbmZvLCBjb2RlT3JCaW5hcnlEYXRhLCBtaW1lVHlwZSwgZGVwZW5kZW50RmlsZXMpIHtcbiAgICBsZXQgYnVmID0gbnVsbDtcbiAgICBsZXQgdGFyZ2V0ID0gcGF0aC5qb2luKHRoaXMuZ2V0Q2FjaGVQYXRoKCksIGhhc2hJbmZvLmhhc2gpO1xuICAgIGQoYFNhdmluZyB0byAke3RhcmdldH1gKTtcblxuICAgIGlmIChoYXNoSW5mby5pc0ZpbGVCaW5hcnkpIHtcbiAgICAgIGJ1ZiA9IHpsaWIuZ3ppcFN5bmMoY29kZU9yQmluYXJ5RGF0YSk7XG4gICAgICBmcy53cml0ZUZpbGVTeW5jKHRhcmdldCArICcuaW5mbycsIEpTT04uc3RyaW5naWZ5KHttaW1lVHlwZSwgZGVwZW5kZW50RmlsZXN9KSwgJ3V0ZjgnKTtcbiAgICB9IGVsc2Uge1xuICAgICAgYnVmID0gemxpYi5nemlwU3luYyhuZXcgQnVmZmVyKEpTT04uc3RyaW5naWZ5KHtjb2RlOiBjb2RlT3JCaW5hcnlEYXRhLCBtaW1lVHlwZSwgZGVwZW5kZW50RmlsZXN9KSkpO1xuICAgIH1cblxuICAgIGZzLndyaXRlRmlsZVN5bmModGFyZ2V0LCBidWYpO1xuICB9XG5cbiAgZ2V0T3JGZXRjaFN5bmMoZmlsZVBhdGgsIGZldGNoZXIpIHtcbiAgICBsZXQgY2FjaGVSZXN1bHQgPSB0aGlzLmdldFN5bmMoZmlsZVBhdGgpO1xuICAgIGlmIChjYWNoZVJlc3VsdC5jb2RlIHx8IGNhY2hlUmVzdWx0LmJpbmFyeURhdGEpIHJldHVybiBjYWNoZVJlc3VsdDtcblxuICAgIGxldCByZXN1bHQgPSBmZXRjaGVyKGZpbGVQYXRoLCBjYWNoZVJlc3VsdC5oYXNoSW5mbykgfHwgeyBoYXNoSW5mbzogY2FjaGVSZXN1bHQuaGFzaEluZm8gfTtcblxuICAgIGlmIChyZXN1bHQubWltZVR5cGUgJiYgIWNhY2hlUmVzdWx0Lmhhc2hJbmZvLmlzSW5Ob2RlTW9kdWxlcykge1xuICAgICAgZChgQ2FjaGUgbWlzczogc2F2aW5nIG91dCBpbmZvIGZvciAke2ZpbGVQYXRofWApO1xuICAgICAgdGhpcy5zYXZlU3luYyhjYWNoZVJlc3VsdC5oYXNoSW5mbywgcmVzdWx0LmNvZGUgfHwgcmVzdWx0LmJpbmFyeURhdGEsIHJlc3VsdC5taW1lVHlwZSwgcmVzdWx0LmRlcGVuZGVudEZpbGVzKTtcbiAgICB9XG5cbiAgICBjb25zdCBtYXAgPSByZXN1bHQuc291cmNlTWFwcztcbiAgICBpZiAobWFwKSB7XG4gICAgICBkKGBzb3VyY2UgbWFwIGZvciAke2ZpbGVQYXRofSBmb3VuZCwgc2F2aW5nIGl0IHRvICR7dGhpcy5nZXRTb3VyY2VNYXBQYXRoKCl9YCk7XG4gICAgICB0aGlzLnNhdmVTb3VyY2VNYXBTeW5jKGNhY2hlUmVzdWx0Lmhhc2hJbmZvLCBmaWxlUGF0aCwgbWFwKTtcbiAgICB9XG5cbiAgICByZXN1bHQuaGFzaEluZm8gPSBjYWNoZVJlc3VsdC5oYXNoSW5mbztcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgYnVpbGRTb3VyY2VNYXBUYXJnZXQoaGFzaEluZm8sIGZpbGVQYXRoKSB7XG4gICAgY29uc3QgZmlsZU5hbWUgPSBwYXRoLmJhc2VuYW1lKGZpbGVQYXRoKTtcbiAgICBjb25zdCBtYXBGaWxlTmFtZSA9IGZpbGVOYW1lLnJlcGxhY2UocGF0aC5leHRuYW1lKGZpbGVOYW1lKSwgJy5qcy5tYXAnKTtcblxuICAgIGNvbnN0IHRhcmdldCA9IHBhdGguam9pbih0aGlzLmdldFNvdXJjZU1hcFBhdGgoKSwgbWFwRmlsZU5hbWUpO1xuICAgIGQoYFNvdXJjZW1hcCB0YXJnZXQgaXM6ICR7dGFyZ2V0fWApO1xuXG4gICAgcmV0dXJuIHRhcmdldDtcbiAgfVxuXG4gIC8qKlxuICAgKiBTYXZlcyBzb3VyY2VtYXAgc3RyaW5nIGludG8gY2FjaGUsIG9yIHNwZWNpZmllZCBzZXBhcmF0ZSBkaXJcbiAgICpcbiAgICogQHBhcmFtICB7T2JqZWN0fSBoYXNoSW5mbyAgVGhlIGhhc2ggaW5mb3JtYXRpb24gcmV0dXJuZWQgZnJvbSBnZXRIYXNoRm9yUGF0aFxuICAgKlxuICAgKiBAcGFyYW0gIHtzdHJpbmd9IGZpbGVQYXRoIFBhdGggdG8gb3JpZ2luYWwgZmlsZSB0byBjb25zdHJ1Y3Qgc291cmNlbWFwIGZpbGUgbmFtZVxuXG4gICAqIEBwYXJhbSAge3N0cmluZ30gc291cmNlTWFwIFNvdXJjZW1hcCBkYXRhIGFzIHN0cmluZ1xuICAgKlxuICAgKiBAbWVtYmVyT2YgQ29tcGlsZUNhY2hlXG4gICAqL1xuICBhc3luYyBzYXZlU291cmNlTWFwKGhhc2hJbmZvLCBmaWxlUGF0aCwgc291cmNlTWFwKSB7XG4gICAgY29uc3QgdGFyZ2V0ID0gdGhpcy5idWlsZFNvdXJjZU1hcFRhcmdldChoYXNoSW5mbywgZmlsZVBhdGgpO1xuICAgIGF3YWl0IHBmcy53cml0ZUZpbGUodGFyZ2V0LCBzb3VyY2VNYXAsICd1dGYtOCcpO1xuICB9XG5cbiAgc2F2ZVNvdXJjZU1hcFN5bmMoaGFzaEluZm8sIGZpbGVQYXRoLCBzb3VyY2VNYXApIHtcbiAgICBjb25zdCB0YXJnZXQgPSB0aGlzLmJ1aWxkU291cmNlTWFwVGFyZ2V0KGhhc2hJbmZvLCBmaWxlUGF0aCk7XG4gICAgZnMud3JpdGVGaWxlU3luYyh0YXJnZXQsIHNvdXJjZU1hcCwgJ3V0Zi04Jyk7XG4gIH1cblxuICAvKipcbiAgICogQHByaXZhdGVcbiAgICovXG4gIGdldENhY2hlUGF0aCgpIHtcbiAgICAvLyBOQjogVGhpcyBpcyBhbiBldmlsIGhhY2sgc28gdGhhdCBjcmVhdGVGcm9tQ29tcGlsZXIgY2FuIHN0b21wIGl0XG4gICAgLy8gYXQgd2lsbFxuICAgIHJldHVybiB0aGlzLmNhY2hlUGF0aDtcbiAgfVxuXG4gIC8qKlxuICAgKiBAcHJpdmF0ZVxuICAgKi9cbiAgZ2V0U291cmNlTWFwUGF0aCgpIHtcbiAgICByZXR1cm4gdGhpcy5zb3VyY2VNYXBQYXRoO1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgd2hldGhlciBhIGZpbGUgc2hvdWxkIG5vdCBiZSBjb21waWxlZC4gTm90ZSB0aGF0IHRoaXMgZG9lc24ndFxuICAgKiBuZWNlc3NhcmlseSBtZWFuIGl0IHdvbid0IGVuZCB1cCBpbiB0aGUgY2FjaGUsIG9ubHkgdGhhdCBpdHMgY29udGVudHMgYXJlXG4gICAqIHNhdmVkIHZlcmJhdGltIGluc3RlYWQgb2YgdHJ5aW5nIHRvIGZpbmQgYW4gYXBwcm9wcmlhdGUgY29tcGlsZXIuXG4gICAqXG4gICAqIEBwYXJhbSAge09iamVjdH0gaGFzaEluZm8gIFRoZSBoYXNoIGluZm9ybWF0aW9uIHJldHVybmVkIGZyb20gZ2V0SGFzaEZvclBhdGhcbiAgICpcbiAgICogQHJldHVybiB7Ym9vbGVhbn0gIFRydWUgaWYgYSBmaWxlIHNob3VsZCBiZSBpZ25vcmVkXG4gICAqL1xuICBzdGF0aWMgc2hvdWxkUGFzc3Rocm91Z2goaGFzaEluZm8pIHtcbiAgICByZXR1cm4gaGFzaEluZm8uaXNNaW5pZmllZCB8fCBoYXNoSW5mby5pc0luTm9kZU1vZHVsZXMgfHwgaGFzaEluZm8uaGFzU291cmNlTWFwIHx8IGhhc2hJbmZvLmlzRmlsZUJpbmFyeTtcbiAgfVxufVxuIl19