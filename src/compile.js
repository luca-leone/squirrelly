import { regEx, setup, replaceHelperRefs } from './regexps'
import nativeHelpers from './nativeHelpers'
import { parseFiltered } from './filters'
import P from './partials'

function Compile (str) {
  var lastIndex = 0 // Because lastIndex can be complicated, and this way the minifier can minify more
  var funcStr = "var tR='';" // This will be called with Function() and returned
  var helperArray = [] // A list of all 'outstanding' helpers, or unclosed helpers
  var helperNumber = -1
  var helperAutoId = 0 // Squirrelly automatically generates an ID for helpers that don't have a custom ID
  var helperContainsBlocks = {} // If a helper contains any blocks, helperContainsBlocks[helperID] will be set to true
  var m

  function addString (indx) {
    if (lastIndex !== indx) {
      funcStr +=
        "tR+='" +
        str
          .slice(lastIndex, indx)
          .replace(/\\/g, '\\\\')
          .replace(/'/g, "\\'") +
        "';"
    }
  }
  function globalRef (refName, filters) {
    return parseFiltered('options.' + refName, filters)
  }

  function helperRef (name, id, filters) {
    var content = replaceHelperRefs(name)
    return parseFiltered(content, filters)
  }
  setup()
  while ((m = regEx.exec(str)) !== null) {
    addString(m.index) // Add the string between the last tag (or start of file) and the current tag
    lastIndex = m[0].length + m.index
    if (m[1]) {
      // It's a global ref. p4 = filters
      funcStr += 'tR+=' + globalRef(m[1], m[4]) + ';'
    } else if (m[3]) {
      // It's a helper ref. p2 = id (with ':' after it) or path, p4 = filters
      funcStr += 'tR+=' + helperRef(m[3], m[2], m[4]) + ';'
    } else if (m[5]) {
      // It's a helper oTag. p6 parameters, p7 id
      var id = m[7]
      if (id === '' || id === null) {
        id = helperAutoId
        helperAutoId++
      }
      var native = nativeHelpers.hasOwnProperty(m[5]) // true or false
      helperNumber += 1
      var params = m[6] || ''
      params = replaceHelperRefs(params)
      if (!native) {
        params = '[' + params + ']'
      }
      var helperTag = {
        name: m[5],
        id: id,
        params: params,
        native: native
      }
      helperArray[helperNumber] = helperTag
      if (native) {
        funcStr += nativeHelpers[m[5]].helperStart(params, id)
        lastIndex = regEx.lastIndex // the changeTags function sets lastIndex already
      } else {
        funcStr +=
          'tR+=Sqrl.H.' +
          m[5] +
          '(' +
          params +
          ',function(hvals){var hvals' +
          id +
          "=hvals;var tR='';"
      }
    } else if (m[8]) {
      // It's a helper cTag.
      var mostRecentHelper = helperArray[helperNumber]
      if (mostRecentHelper && mostRecentHelper.name === m[8]) {
        helperNumber -= 1
        if (mostRecentHelper.native === true) {
          funcStr += nativeHelpers[mostRecentHelper.name].helperEnd(
            mostRecentHelper.params,
            mostRecentHelper.id
          )
        } else {
          if (helperContainsBlocks[mostRecentHelper.id]) {
            funcStr += 'return tR}});'
          } else {
            funcStr += 'return tR});'
          }
        }
      } else {
        console.error("Helper beginning & end don't match.")
      }
    } else if (m[9]) {
      // It's a helper block.
      var parent = helperArray[helperNumber]
      if (parent.native) {
        var nativeH = nativeHelpers[parent.name]
        if (nativeH.blocks && nativeH.blocks[m[9]]) {
          funcStr += nativeH.blocks[m[9]](parent.id)
          lastIndex = regEx.lastIndex // Some native helpers set regEx.lastIndex
        } else {
          console.warn(
            "Native helper '%s' doesn't accept that block.",
            parent.name
          )
        }
      } else {
        if (!helperContainsBlocks[parent.id]) {
          funcStr +=
            'return tR},{' +
            m[9] +
            ':function(hvals){var hvals' +
            parent.id +
            "=hvals;var tR='';"
          helperContainsBlocks[parent.id] = true
        } else {
          funcStr +=
            'return tR},' +
            m[9] +
            ':function(hvals){var hvals' +
            parent.id +
            "=hvals;var tR='';"
        }
      }
    } else if (m[10]) {
      // It's a self-closing helper
      var innerParams = m[11] || ''
      innerParams = replaceHelperRefs(innerParams)
      if (m[10] === 'include') {
        // This code literally gets the template string up to the include self-closing helper,
        // adds the content of the partial, and adds the template string after the include self-closing helper
        var preContent = str.slice(0, m.index)
        var endContent = str.slice(m.index + m[0].length)
        var partialParams = innerParams.replace(/'|"/g, '') // So people can write {{include(mypartial)/}} or {{include('mypartial')/}}
        var partialContent = P[partialParams]
        str = preContent + partialContent + endContent
        lastIndex = regEx.lastIndex = m.index
      } else if (
        nativeHelpers.hasOwnProperty(m[10]) &&
        nativeHelpers[m[10]].hasOwnProperty('selfClosing')
      ) {
        funcStr += nativeHelpers[m[10]].selfClosing(innerParams)
        lastIndex = regEx.lastIndex // changeTags sets regEx.lastIndex
      } else {
        funcStr += 'tR+=Sqrl.H.' + m[10] + '(' + innerParams + ');' // If it's not native, passing args to a non-native helper
      }
    }
  }
  addString(str.length) // Add the string from the last tag-close to the end of the file, if there is one
  funcStr += 'return tR'
  var func = new Function( //eslint-disable-line
    'options',
    'Sqrl',
    funcStr.replace(/\n/g, '\\n').replace(/\r/g, '\\r')
  )
  return func
}

export default Compile
