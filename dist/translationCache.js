"use strict";
const fs = require('fs');
const pathPlatformDependent = require("path");
const path = pathPlatformDependent.posix; // This works everythere, just use forward slashes
const pathUtils = require("./pathUtils");
const indexOfLangsMessages = 4;
class TranslationDb {
    constructor() {
        this.clear();
    }
    clear() {
        this.db = Object.create(null);
        this.langs = [];
        this.usages = Object.create(null);
        this.availNumbers = [];
        this.nextFreeId = 0;
        this.changeInMessageIds = false;
    }
    addLang(name) {
        let pos = this.langs.indexOf(name);
        if (pos >= 0)
            return pos;
        this.langs.push(name);
        return this.langs.length - 1;
    }
    buildKey(message, hint, hasParams) {
        return message + '\x01\x02' + (hasParams ? '#' : '-') + (hint || '');
    }
    loadLangDbs(dir) {
        let trFiles;
        try {
            trFiles = fs.readdirSync(dir).filter(v => /\.json$/i.test(v));
        }
        catch (err) {
            // ignore errors
            return;
        }
        trFiles.forEach(v => {
            this.loadLangDb(path.join(dir, v));
        });
    }
    loadLangDb(fileName) {
        let json = JSON.parse(fs.readFileSync(fileName, 'utf-8'));
        if (!Array.isArray(json))
            throw new Error('root object is not array');
        if (json.length === 0)
            throw new Error('array cannot be empty');
        let lang = json[0];
        if (typeof lang !== 'string')
            throw new Error('first item must be string');
        let langidx = indexOfLangsMessages + this.addLang(lang);
        for (let i = 1; i < json.length; i++) {
            let item = json[i];
            if (!Array.isArray(item))
                throw new Error('items must be array');
            if (item.length !== 3 && item.length !== 4)
                throw new Error('items must have length==3 or 4');
            let message = item[0];
            let hint = item[1];
            let flags = item[2];
            if (typeof message !== 'string')
                throw new Error('item[0] must be message string');
            if (hint != null && typeof hint !== 'string')
                throw new Error('item[1] must be hint string or null');
            if (typeof flags !== 'number')
                throw new Error('item[2] must be flags number');
            let key = this.buildKey(item[0], item[1], (item[2] & 1) !== 0);
            let tr = this.db[key];
            if (tr) {
                if (item.length === 4) {
                    tr[langidx] = item[3];
                }
            }
            else {
                tr = [message, hint, flags, null];
                if (item.length === 4) {
                    tr[langidx] = item[3];
                }
                this.db[key] = tr;
            }
        }
    }
    removeLang(lang) {
        let pos = this.langs.indexOf(lang);
        if (pos < 0)
            return;
        pos += indexOfLangsMessages;
        for (let key in this.db) {
            let tr = this.db[key];
            tr.splice(pos, 1);
        }
    }
    saveLangDbs(dir) {
        pathUtils.mkpathsync(dir);
        this.langs.forEach(lang => {
            this.saveLangDb(path.join(dir, lang + ".json"), lang);
        });
    }
    saveLangDb(filename, lang) {
        let pos = this.langs.indexOf(lang);
        if (pos < 0)
            pos = this.langs.length;
        pos += indexOfLangsMessages;
        let items = [lang];
        for (let key in this.db) {
            let tr = this.db[key];
            let trl = tr[pos];
            if (trl != null) {
                items.push([tr[0], tr[1], tr[2] & 1, trl]);
            }
            else {
                items.push([tr[0], tr[1], tr[2] & 1]);
            }
        }
        fs.writeFileSync(filename, JSON.stringify(items));
    }
    pruneUnusedMesssages() {
        let list = Object.keys(this.db);
        for (let i = 0; i < list.length; i++) {
            let tr = this.db[list[i]];
            if (tr[2] < 2) {
                delete this.db[list[i]];
            }
        }
    }
    allocId() {
        if (this.availNumbers.length === 0) {
            return this.nextFreeId++;
        }
        return this.availNumbers.pop();
    }
    freeId(id) {
        this.availNumbers.push(id);
    }
    clearBeforeCompilation() {
        this.changeInMessageIds = false;
        this.addedMessage = false;
    }
    startCompileFile(fn) {
        this.currentFileUsages = this.usages[fn];
        this.newFileUsages = undefined; // lazy allocated for speed
    }
    addUsageOfMessage(info) {
        let key = this.buildKey(info.message, info.hint, info.withParams);
        if (this.newFileUsages === undefined)
            this.newFileUsages = Object.create(null);
        if (this.currentFileUsages !== undefined && this.currentFileUsages[key] === true) {
            let item = this.db[key];
            delete this.currentFileUsages[key];
            this.newFileUsages[key] = true;
            return item[3];
        }
        let item = this.db[key];
        if (this.newFileUsages[key] === true) {
            return item[3];
        }
        this.newFileUsages[key] = true;
        if (item === undefined) {
            item = [info.message, info.hint, (info.withParams ? 1 : 0) + 2, this.allocId()]; // add as allocated
            this.changeInMessageIds = true;
            this.addedMessage = true;
            this.db[key] = item;
            return item[3];
        }
        if (item[2] < 2) {
            item[2] = item[2] + 2; // add allocated flag
            item[3] = this.allocId();
            this.changeInMessageIds = true;
        }
        else {
            item[2] = item[2] + 2; // increase allocated flag
        }
        return item[3];
    }
    finishCompileFile(fn) {
        if (this.currentFileUsages !== undefined) {
            let keys = Object.keys(this.currentFileUsages);
            for (let i = 0; i < keys.length; i++) {
                let item = this.db[keys[i]];
                item[2] = item[2] - 2; // decrease allocated flag
                if (item[2] < 2) {
                    this.freeId(item[3]);
                }
            }
        }
        this.usages[fn] = this.newFileUsages;
    }
    getMessageArrayInLang(lang) {
        let pos = this.langs.indexOf(lang);
        if (pos < 0)
            pos = this.langs.length;
        pos += indexOfLangsMessages;
        let result = [];
        let db = this.db;
        let list = Object.keys(db);
        for (let i = 0; i < list.length; i++) {
            let item = db[list[i]];
            if (item[2] >= 2) {
                if (item[pos] != null) {
                    result[item[3]] = item[pos];
                }
                else {
                    result[item[3]] = item[0]; // English as fallback
                }
            }
        }
        for (let i = 0; i < result.length; i++) {
            if (result[i] === undefined)
                result[i] = "";
        }
        return result;
    }
    getForTranslationLang(lang) {
        let pos = this.langs.indexOf(lang);
        if (pos < 0)
            pos = this.langs.length;
        pos += indexOfLangsMessages;
        let result = [];
        let db = this.db;
        let list = Object.keys(db);
        for (let i = 0; i < list.length; i++) {
            let item = db[list[i]];
            if (item[pos] != null)
                continue;
            result.push([null, item[0], item[1], item[2] & 1, list[i]]);
        }
        return result;
    }
    setForTranslationLang(lang, trs) {
        let pos = this.langs.indexOf(lang);
        if (pos < 0)
            pos = this.langs.length;
        pos += indexOfLangsMessages;
        let db = this.db;
        for (let i = 0; i < trs.length; i++) {
            let row = trs[i];
            if (typeof row[0] !== 'string')
                continue;
            let item = db[row[4]];
            item[pos] = row[0];
        }
    }
}
exports.TranslationDb = TranslationDb;
//# sourceMappingURL=translationCache.js.map