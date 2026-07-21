(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __esm = (fn, res) => function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  };
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // ../../node_modules/react/cjs/react.production.js
  var require_react_production = __commonJS({
    "../../node_modules/react/cjs/react.production.js"(exports) {
      "use strict";
      var REACT_ELEMENT_TYPE = /* @__PURE__ */ Symbol.for("react.transitional.element");
      var REACT_PORTAL_TYPE = /* @__PURE__ */ Symbol.for("react.portal");
      var REACT_FRAGMENT_TYPE = /* @__PURE__ */ Symbol.for("react.fragment");
      var REACT_STRICT_MODE_TYPE = /* @__PURE__ */ Symbol.for("react.strict_mode");
      var REACT_PROFILER_TYPE = /* @__PURE__ */ Symbol.for("react.profiler");
      var REACT_CONSUMER_TYPE = /* @__PURE__ */ Symbol.for("react.consumer");
      var REACT_CONTEXT_TYPE = /* @__PURE__ */ Symbol.for("react.context");
      var REACT_FORWARD_REF_TYPE = /* @__PURE__ */ Symbol.for("react.forward_ref");
      var REACT_SUSPENSE_TYPE = /* @__PURE__ */ Symbol.for("react.suspense");
      var REACT_MEMO_TYPE = /* @__PURE__ */ Symbol.for("react.memo");
      var REACT_LAZY_TYPE = /* @__PURE__ */ Symbol.for("react.lazy");
      var REACT_ACTIVITY_TYPE = /* @__PURE__ */ Symbol.for("react.activity");
      var MAYBE_ITERATOR_SYMBOL = Symbol.iterator;
      function getIteratorFn(maybeIterable) {
        if (null === maybeIterable || "object" !== typeof maybeIterable) return null;
        maybeIterable = MAYBE_ITERATOR_SYMBOL && maybeIterable[MAYBE_ITERATOR_SYMBOL] || maybeIterable["@@iterator"];
        return "function" === typeof maybeIterable ? maybeIterable : null;
      }
      var ReactNoopUpdateQueue = {
        isMounted: function() {
          return false;
        },
        enqueueForceUpdate: function() {
        },
        enqueueReplaceState: function() {
        },
        enqueueSetState: function() {
        }
      };
      var assign = Object.assign;
      var emptyObject = {};
      function Component(props, context, updater) {
        this.props = props;
        this.context = context;
        this.refs = emptyObject;
        this.updater = updater || ReactNoopUpdateQueue;
      }
      Component.prototype.isReactComponent = {};
      Component.prototype.setState = function(partialState, callback) {
        if ("object" !== typeof partialState && "function" !== typeof partialState && null != partialState)
          throw Error(
            "takes an object of state variables to update or a function which returns an object of state variables."
          );
        this.updater.enqueueSetState(this, partialState, callback, "setState");
      };
      Component.prototype.forceUpdate = function(callback) {
        this.updater.enqueueForceUpdate(this, callback, "forceUpdate");
      };
      function ComponentDummy() {
      }
      ComponentDummy.prototype = Component.prototype;
      function PureComponent(props, context, updater) {
        this.props = props;
        this.context = context;
        this.refs = emptyObject;
        this.updater = updater || ReactNoopUpdateQueue;
      }
      var pureComponentPrototype = PureComponent.prototype = new ComponentDummy();
      pureComponentPrototype.constructor = PureComponent;
      assign(pureComponentPrototype, Component.prototype);
      pureComponentPrototype.isPureReactComponent = true;
      var isArrayImpl = Array.isArray;
      function noop() {
      }
      var ReactSharedInternals = { H: null, A: null, T: null, S: null };
      var hasOwnProperty = Object.prototype.hasOwnProperty;
      function ReactElement(type, key, props) {
        var refProp = props.ref;
        return {
          $$typeof: REACT_ELEMENT_TYPE,
          type,
          key,
          ref: void 0 !== refProp ? refProp : null,
          props
        };
      }
      function cloneAndReplaceKey(oldElement, newKey) {
        return ReactElement(oldElement.type, newKey, oldElement.props);
      }
      function isValidElement(object) {
        return "object" === typeof object && null !== object && object.$$typeof === REACT_ELEMENT_TYPE;
      }
      function escape(key) {
        var escaperLookup = { "=": "=0", ":": "=2" };
        return "$" + key.replace(/[=:]/g, function(match) {
          return escaperLookup[match];
        });
      }
      var userProvidedKeyEscapeRegex = /\/+/g;
      function getElementKey(element, index) {
        return "object" === typeof element && null !== element && null != element.key ? escape("" + element.key) : index.toString(36);
      }
      function resolveThenable(thenable) {
        switch (thenable.status) {
          case "fulfilled":
            return thenable.value;
          case "rejected":
            throw thenable.reason;
          default:
            switch ("string" === typeof thenable.status ? thenable.then(noop, noop) : (thenable.status = "pending", thenable.then(
              function(fulfilledValue) {
                "pending" === thenable.status && (thenable.status = "fulfilled", thenable.value = fulfilledValue);
              },
              function(error) {
                "pending" === thenable.status && (thenable.status = "rejected", thenable.reason = error);
              }
            )), thenable.status) {
              case "fulfilled":
                return thenable.value;
              case "rejected":
                throw thenable.reason;
            }
        }
        throw thenable;
      }
      function mapIntoArray(children, array, escapedPrefix, nameSoFar, callback) {
        var type = typeof children;
        if ("undefined" === type || "boolean" === type) children = null;
        var invokeCallback = false;
        if (null === children) invokeCallback = true;
        else
          switch (type) {
            case "bigint":
            case "string":
            case "number":
              invokeCallback = true;
              break;
            case "object":
              switch (children.$$typeof) {
                case REACT_ELEMENT_TYPE:
                case REACT_PORTAL_TYPE:
                  invokeCallback = true;
                  break;
                case REACT_LAZY_TYPE:
                  return invokeCallback = children._init, mapIntoArray(
                    invokeCallback(children._payload),
                    array,
                    escapedPrefix,
                    nameSoFar,
                    callback
                  );
              }
          }
        if (invokeCallback)
          return callback = callback(children), invokeCallback = "" === nameSoFar ? "." + getElementKey(children, 0) : nameSoFar, isArrayImpl(callback) ? (escapedPrefix = "", null != invokeCallback && (escapedPrefix = invokeCallback.replace(userProvidedKeyEscapeRegex, "$&/") + "/"), mapIntoArray(callback, array, escapedPrefix, "", function(c) {
            return c;
          })) : null != callback && (isValidElement(callback) && (callback = cloneAndReplaceKey(
            callback,
            escapedPrefix + (null == callback.key || children && children.key === callback.key ? "" : ("" + callback.key).replace(
              userProvidedKeyEscapeRegex,
              "$&/"
            ) + "/") + invokeCallback
          )), array.push(callback)), 1;
        invokeCallback = 0;
        var nextNamePrefix = "" === nameSoFar ? "." : nameSoFar + ":";
        if (isArrayImpl(children))
          for (var i = 0; i < children.length; i++)
            nameSoFar = children[i], type = nextNamePrefix + getElementKey(nameSoFar, i), invokeCallback += mapIntoArray(
              nameSoFar,
              array,
              escapedPrefix,
              type,
              callback
            );
        else if (i = getIteratorFn(children), "function" === typeof i)
          for (children = i.call(children), i = 0; !(nameSoFar = children.next()).done; )
            nameSoFar = nameSoFar.value, type = nextNamePrefix + getElementKey(nameSoFar, i++), invokeCallback += mapIntoArray(
              nameSoFar,
              array,
              escapedPrefix,
              type,
              callback
            );
        else if ("object" === type) {
          if ("function" === typeof children.then)
            return mapIntoArray(
              resolveThenable(children),
              array,
              escapedPrefix,
              nameSoFar,
              callback
            );
          array = String(children);
          throw Error(
            "Objects are not valid as a React child (found: " + ("[object Object]" === array ? "object with keys {" + Object.keys(children).join(", ") + "}" : array) + "). If you meant to render a collection of children, use an array instead."
          );
        }
        return invokeCallback;
      }
      function mapChildren(children, func, context) {
        if (null == children) return children;
        var result = [], count = 0;
        mapIntoArray(children, result, "", "", function(child) {
          return func.call(context, child, count++);
        });
        return result;
      }
      function lazyInitializer(payload) {
        if (-1 === payload._status) {
          var ctor = payload._result;
          ctor = ctor();
          ctor.then(
            function(moduleObject) {
              if (0 === payload._status || -1 === payload._status)
                payload._status = 1, payload._result = moduleObject;
            },
            function(error) {
              if (0 === payload._status || -1 === payload._status)
                payload._status = 2, payload._result = error;
            }
          );
          -1 === payload._status && (payload._status = 0, payload._result = ctor);
        }
        if (1 === payload._status) return payload._result.default;
        throw payload._result;
      }
      var reportGlobalError = "function" === typeof reportError ? reportError : function(error) {
        if ("object" === typeof window && "function" === typeof window.ErrorEvent) {
          var event = new window.ErrorEvent("error", {
            bubbles: true,
            cancelable: true,
            message: "object" === typeof error && null !== error && "string" === typeof error.message ? String(error.message) : String(error),
            error
          });
          if (!window.dispatchEvent(event)) return;
        } else if ("object" === typeof process && "function" === typeof process.emit) {
          process.emit("uncaughtException", error);
          return;
        }
        console.error(error);
      };
      var Children = {
        map: mapChildren,
        forEach: function(children, forEachFunc, forEachContext) {
          mapChildren(
            children,
            function() {
              forEachFunc.apply(this, arguments);
            },
            forEachContext
          );
        },
        count: function(children) {
          var n = 0;
          mapChildren(children, function() {
            n++;
          });
          return n;
        },
        toArray: function(children) {
          return mapChildren(children, function(child) {
            return child;
          }) || [];
        },
        only: function(children) {
          if (!isValidElement(children))
            throw Error(
              "React.Children.only expected to receive a single React element child."
            );
          return children;
        }
      };
      exports.Activity = REACT_ACTIVITY_TYPE;
      exports.Children = Children;
      exports.Component = Component;
      exports.Fragment = REACT_FRAGMENT_TYPE;
      exports.Profiler = REACT_PROFILER_TYPE;
      exports.PureComponent = PureComponent;
      exports.StrictMode = REACT_STRICT_MODE_TYPE;
      exports.Suspense = REACT_SUSPENSE_TYPE;
      exports.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = ReactSharedInternals;
      exports.__COMPILER_RUNTIME = {
        __proto__: null,
        c: function(size) {
          return ReactSharedInternals.H.useMemoCache(size);
        }
      };
      exports.cache = function(fn) {
        return function() {
          return fn.apply(null, arguments);
        };
      };
      exports.cacheSignal = function() {
        return null;
      };
      exports.cloneElement = function(element, config, children) {
        if (null === element || void 0 === element)
          throw Error(
            "The argument must be a React element, but you passed " + element + "."
          );
        var props = assign({}, element.props), key = element.key;
        if (null != config)
          for (propName in void 0 !== config.key && (key = "" + config.key), config)
            !hasOwnProperty.call(config, propName) || "key" === propName || "__self" === propName || "__source" === propName || "ref" === propName && void 0 === config.ref || (props[propName] = config[propName]);
        var propName = arguments.length - 2;
        if (1 === propName) props.children = children;
        else if (1 < propName) {
          for (var childArray = Array(propName), i = 0; i < propName; i++)
            childArray[i] = arguments[i + 2];
          props.children = childArray;
        }
        return ReactElement(element.type, key, props);
      };
      exports.createContext = function(defaultValue) {
        defaultValue = {
          $$typeof: REACT_CONTEXT_TYPE,
          _currentValue: defaultValue,
          _currentValue2: defaultValue,
          _threadCount: 0,
          Provider: null,
          Consumer: null
        };
        defaultValue.Provider = defaultValue;
        defaultValue.Consumer = {
          $$typeof: REACT_CONSUMER_TYPE,
          _context: defaultValue
        };
        return defaultValue;
      };
      exports.createElement = function(type, config, children) {
        var propName, props = {}, key = null;
        if (null != config)
          for (propName in void 0 !== config.key && (key = "" + config.key), config)
            hasOwnProperty.call(config, propName) && "key" !== propName && "__self" !== propName && "__source" !== propName && (props[propName] = config[propName]);
        var childrenLength = arguments.length - 2;
        if (1 === childrenLength) props.children = children;
        else if (1 < childrenLength) {
          for (var childArray = Array(childrenLength), i = 0; i < childrenLength; i++)
            childArray[i] = arguments[i + 2];
          props.children = childArray;
        }
        if (type && type.defaultProps)
          for (propName in childrenLength = type.defaultProps, childrenLength)
            void 0 === props[propName] && (props[propName] = childrenLength[propName]);
        return ReactElement(type, key, props);
      };
      exports.createRef = function() {
        return { current: null };
      };
      exports.forwardRef = function(render) {
        return { $$typeof: REACT_FORWARD_REF_TYPE, render };
      };
      exports.isValidElement = isValidElement;
      exports.lazy = function(ctor) {
        return {
          $$typeof: REACT_LAZY_TYPE,
          _payload: { _status: -1, _result: ctor },
          _init: lazyInitializer
        };
      };
      exports.memo = function(type, compare) {
        return {
          $$typeof: REACT_MEMO_TYPE,
          type,
          compare: void 0 === compare ? null : compare
        };
      };
      exports.startTransition = function(scope) {
        var prevTransition = ReactSharedInternals.T, currentTransition = {};
        ReactSharedInternals.T = currentTransition;
        try {
          var returnValue = scope(), onStartTransitionFinish = ReactSharedInternals.S;
          null !== onStartTransitionFinish && onStartTransitionFinish(currentTransition, returnValue);
          "object" === typeof returnValue && null !== returnValue && "function" === typeof returnValue.then && returnValue.then(noop, reportGlobalError);
        } catch (error) {
          reportGlobalError(error);
        } finally {
          null !== prevTransition && null !== currentTransition.types && (prevTransition.types = currentTransition.types), ReactSharedInternals.T = prevTransition;
        }
      };
      exports.unstable_useCacheRefresh = function() {
        return ReactSharedInternals.H.useCacheRefresh();
      };
      exports.use = function(usable) {
        return ReactSharedInternals.H.use(usable);
      };
      exports.useActionState = function(action, initialState, permalink) {
        return ReactSharedInternals.H.useActionState(action, initialState, permalink);
      };
      exports.useCallback = function(callback, deps) {
        return ReactSharedInternals.H.useCallback(callback, deps);
      };
      exports.useContext = function(Context) {
        return ReactSharedInternals.H.useContext(Context);
      };
      exports.useDebugValue = function() {
      };
      exports.useDeferredValue = function(value, initialValue) {
        return ReactSharedInternals.H.useDeferredValue(value, initialValue);
      };
      exports.useEffect = function(create, deps) {
        return ReactSharedInternals.H.useEffect(create, deps);
      };
      exports.useEffectEvent = function(callback) {
        return ReactSharedInternals.H.useEffectEvent(callback);
      };
      exports.useId = function() {
        return ReactSharedInternals.H.useId();
      };
      exports.useImperativeHandle = function(ref, create, deps) {
        return ReactSharedInternals.H.useImperativeHandle(ref, create, deps);
      };
      exports.useInsertionEffect = function(create, deps) {
        return ReactSharedInternals.H.useInsertionEffect(create, deps);
      };
      exports.useLayoutEffect = function(create, deps) {
        return ReactSharedInternals.H.useLayoutEffect(create, deps);
      };
      exports.useMemo = function(create, deps) {
        return ReactSharedInternals.H.useMemo(create, deps);
      };
      exports.useOptimistic = function(passthrough, reducer) {
        return ReactSharedInternals.H.useOptimistic(passthrough, reducer);
      };
      exports.useReducer = function(reducer, initialArg, init) {
        return ReactSharedInternals.H.useReducer(reducer, initialArg, init);
      };
      exports.useRef = function(initialValue) {
        return ReactSharedInternals.H.useRef(initialValue);
      };
      exports.useState = function(initialState) {
        return ReactSharedInternals.H.useState(initialState);
      };
      exports.useSyncExternalStore = function(subscribe2, getSnapshot, getServerSnapshot) {
        return ReactSharedInternals.H.useSyncExternalStore(
          subscribe2,
          getSnapshot,
          getServerSnapshot
        );
      };
      exports.useTransition = function() {
        return ReactSharedInternals.H.useTransition();
      };
      exports.version = "19.2.6";
    }
  });

  // ../../node_modules/react/cjs/react.development.js
  var require_react_development = __commonJS({
    "../../node_modules/react/cjs/react.development.js"(exports, module) {
      "use strict";
      "production" !== process.env.NODE_ENV && (function() {
        function defineDeprecationWarning(methodName, info) {
          Object.defineProperty(Component.prototype, methodName, {
            get: function() {
              console.warn(
                "%s(...) is deprecated in plain JavaScript React classes. %s",
                info[0],
                info[1]
              );
            }
          });
        }
        function getIteratorFn(maybeIterable) {
          if (null === maybeIterable || "object" !== typeof maybeIterable)
            return null;
          maybeIterable = MAYBE_ITERATOR_SYMBOL && maybeIterable[MAYBE_ITERATOR_SYMBOL] || maybeIterable["@@iterator"];
          return "function" === typeof maybeIterable ? maybeIterable : null;
        }
        function warnNoop(publicInstance, callerName) {
          publicInstance = (publicInstance = publicInstance.constructor) && (publicInstance.displayName || publicInstance.name) || "ReactClass";
          var warningKey = publicInstance + "." + callerName;
          didWarnStateUpdateForUnmountedComponent[warningKey] || (console.error(
            "Can't call %s on a component that is not yet mounted. This is a no-op, but it might indicate a bug in your application. Instead, assign to `this.state` directly or define a `state = {};` class property with the desired state in the %s component.",
            callerName,
            publicInstance
          ), didWarnStateUpdateForUnmountedComponent[warningKey] = true);
        }
        function Component(props, context, updater) {
          this.props = props;
          this.context = context;
          this.refs = emptyObject;
          this.updater = updater || ReactNoopUpdateQueue;
        }
        function ComponentDummy() {
        }
        function PureComponent(props, context, updater) {
          this.props = props;
          this.context = context;
          this.refs = emptyObject;
          this.updater = updater || ReactNoopUpdateQueue;
        }
        function noop() {
        }
        function testStringCoercion(value) {
          return "" + value;
        }
        function checkKeyStringCoercion(value) {
          try {
            testStringCoercion(value);
            var JSCompiler_inline_result = false;
          } catch (e) {
            JSCompiler_inline_result = true;
          }
          if (JSCompiler_inline_result) {
            JSCompiler_inline_result = console;
            var JSCompiler_temp_const = JSCompiler_inline_result.error;
            var JSCompiler_inline_result$jscomp$0 = "function" === typeof Symbol && Symbol.toStringTag && value[Symbol.toStringTag] || value.constructor.name || "Object";
            JSCompiler_temp_const.call(
              JSCompiler_inline_result,
              "The provided key is an unsupported type %s. This value must be coerced to a string before using it here.",
              JSCompiler_inline_result$jscomp$0
            );
            return testStringCoercion(value);
          }
        }
        function getComponentNameFromType(type) {
          if (null == type) return null;
          if ("function" === typeof type)
            return type.$$typeof === REACT_CLIENT_REFERENCE ? null : type.displayName || type.name || null;
          if ("string" === typeof type) return type;
          switch (type) {
            case REACT_FRAGMENT_TYPE:
              return "Fragment";
            case REACT_PROFILER_TYPE:
              return "Profiler";
            case REACT_STRICT_MODE_TYPE:
              return "StrictMode";
            case REACT_SUSPENSE_TYPE:
              return "Suspense";
            case REACT_SUSPENSE_LIST_TYPE:
              return "SuspenseList";
            case REACT_ACTIVITY_TYPE:
              return "Activity";
          }
          if ("object" === typeof type)
            switch ("number" === typeof type.tag && console.error(
              "Received an unexpected object in getComponentNameFromType(). This is likely a bug in React. Please file an issue."
            ), type.$$typeof) {
              case REACT_PORTAL_TYPE:
                return "Portal";
              case REACT_CONTEXT_TYPE:
                return type.displayName || "Context";
              case REACT_CONSUMER_TYPE:
                return (type._context.displayName || "Context") + ".Consumer";
              case REACT_FORWARD_REF_TYPE:
                var innerType = type.render;
                type = type.displayName;
                type || (type = innerType.displayName || innerType.name || "", type = "" !== type ? "ForwardRef(" + type + ")" : "ForwardRef");
                return type;
              case REACT_MEMO_TYPE:
                return innerType = type.displayName || null, null !== innerType ? innerType : getComponentNameFromType(type.type) || "Memo";
              case REACT_LAZY_TYPE:
                innerType = type._payload;
                type = type._init;
                try {
                  return getComponentNameFromType(type(innerType));
                } catch (x) {
                }
            }
          return null;
        }
        function getTaskName(type) {
          if (type === REACT_FRAGMENT_TYPE) return "<>";
          if ("object" === typeof type && null !== type && type.$$typeof === REACT_LAZY_TYPE)
            return "<...>";
          try {
            var name = getComponentNameFromType(type);
            return name ? "<" + name + ">" : "<...>";
          } catch (x) {
            return "<...>";
          }
        }
        function getOwner() {
          var dispatcher = ReactSharedInternals.A;
          return null === dispatcher ? null : dispatcher.getOwner();
        }
        function UnknownOwner() {
          return Error("react-stack-top-frame");
        }
        function hasValidKey(config) {
          if (hasOwnProperty.call(config, "key")) {
            var getter = Object.getOwnPropertyDescriptor(config, "key").get;
            if (getter && getter.isReactWarning) return false;
          }
          return void 0 !== config.key;
        }
        function defineKeyPropWarningGetter(props, displayName) {
          function warnAboutAccessingKey() {
            specialPropKeyWarningShown || (specialPropKeyWarningShown = true, console.error(
              "%s: `key` is not a prop. Trying to access it will result in `undefined` being returned. If you need to access the same value within the child component, you should pass it as a different prop. (https://react.dev/link/special-props)",
              displayName
            ));
          }
          warnAboutAccessingKey.isReactWarning = true;
          Object.defineProperty(props, "key", {
            get: warnAboutAccessingKey,
            configurable: true
          });
        }
        function elementRefGetterWithDeprecationWarning() {
          var componentName = getComponentNameFromType(this.type);
          didWarnAboutElementRef[componentName] || (didWarnAboutElementRef[componentName] = true, console.error(
            "Accessing element.ref was removed in React 19. ref is now a regular prop. It will be removed from the JSX Element type in a future release."
          ));
          componentName = this.props.ref;
          return void 0 !== componentName ? componentName : null;
        }
        function ReactElement(type, key, props, owner, debugStack, debugTask) {
          var refProp = props.ref;
          type = {
            $$typeof: REACT_ELEMENT_TYPE,
            type,
            key,
            props,
            _owner: owner
          };
          null !== (void 0 !== refProp ? refProp : null) ? Object.defineProperty(type, "ref", {
            enumerable: false,
            get: elementRefGetterWithDeprecationWarning
          }) : Object.defineProperty(type, "ref", { enumerable: false, value: null });
          type._store = {};
          Object.defineProperty(type._store, "validated", {
            configurable: false,
            enumerable: false,
            writable: true,
            value: 0
          });
          Object.defineProperty(type, "_debugInfo", {
            configurable: false,
            enumerable: false,
            writable: true,
            value: null
          });
          Object.defineProperty(type, "_debugStack", {
            configurable: false,
            enumerable: false,
            writable: true,
            value: debugStack
          });
          Object.defineProperty(type, "_debugTask", {
            configurable: false,
            enumerable: false,
            writable: true,
            value: debugTask
          });
          Object.freeze && (Object.freeze(type.props), Object.freeze(type));
          return type;
        }
        function cloneAndReplaceKey(oldElement, newKey) {
          newKey = ReactElement(
            oldElement.type,
            newKey,
            oldElement.props,
            oldElement._owner,
            oldElement._debugStack,
            oldElement._debugTask
          );
          oldElement._store && (newKey._store.validated = oldElement._store.validated);
          return newKey;
        }
        function validateChildKeys(node) {
          isValidElement(node) ? node._store && (node._store.validated = 1) : "object" === typeof node && null !== node && node.$$typeof === REACT_LAZY_TYPE && ("fulfilled" === node._payload.status ? isValidElement(node._payload.value) && node._payload.value._store && (node._payload.value._store.validated = 1) : node._store && (node._store.validated = 1));
        }
        function isValidElement(object) {
          return "object" === typeof object && null !== object && object.$$typeof === REACT_ELEMENT_TYPE;
        }
        function escape(key) {
          var escaperLookup = { "=": "=0", ":": "=2" };
          return "$" + key.replace(/[=:]/g, function(match) {
            return escaperLookup[match];
          });
        }
        function getElementKey(element, index) {
          return "object" === typeof element && null !== element && null != element.key ? (checkKeyStringCoercion(element.key), escape("" + element.key)) : index.toString(36);
        }
        function resolveThenable(thenable) {
          switch (thenable.status) {
            case "fulfilled":
              return thenable.value;
            case "rejected":
              throw thenable.reason;
            default:
              switch ("string" === typeof thenable.status ? thenable.then(noop, noop) : (thenable.status = "pending", thenable.then(
                function(fulfilledValue) {
                  "pending" === thenable.status && (thenable.status = "fulfilled", thenable.value = fulfilledValue);
                },
                function(error) {
                  "pending" === thenable.status && (thenable.status = "rejected", thenable.reason = error);
                }
              )), thenable.status) {
                case "fulfilled":
                  return thenable.value;
                case "rejected":
                  throw thenable.reason;
              }
          }
          throw thenable;
        }
        function mapIntoArray(children, array, escapedPrefix, nameSoFar, callback) {
          var type = typeof children;
          if ("undefined" === type || "boolean" === type) children = null;
          var invokeCallback = false;
          if (null === children) invokeCallback = true;
          else
            switch (type) {
              case "bigint":
              case "string":
              case "number":
                invokeCallback = true;
                break;
              case "object":
                switch (children.$$typeof) {
                  case REACT_ELEMENT_TYPE:
                  case REACT_PORTAL_TYPE:
                    invokeCallback = true;
                    break;
                  case REACT_LAZY_TYPE:
                    return invokeCallback = children._init, mapIntoArray(
                      invokeCallback(children._payload),
                      array,
                      escapedPrefix,
                      nameSoFar,
                      callback
                    );
                }
            }
          if (invokeCallback) {
            invokeCallback = children;
            callback = callback(invokeCallback);
            var childKey = "" === nameSoFar ? "." + getElementKey(invokeCallback, 0) : nameSoFar;
            isArrayImpl(callback) ? (escapedPrefix = "", null != childKey && (escapedPrefix = childKey.replace(userProvidedKeyEscapeRegex, "$&/") + "/"), mapIntoArray(callback, array, escapedPrefix, "", function(c) {
              return c;
            })) : null != callback && (isValidElement(callback) && (null != callback.key && (invokeCallback && invokeCallback.key === callback.key || checkKeyStringCoercion(callback.key)), escapedPrefix = cloneAndReplaceKey(
              callback,
              escapedPrefix + (null == callback.key || invokeCallback && invokeCallback.key === callback.key ? "" : ("" + callback.key).replace(
                userProvidedKeyEscapeRegex,
                "$&/"
              ) + "/") + childKey
            ), "" !== nameSoFar && null != invokeCallback && isValidElement(invokeCallback) && null == invokeCallback.key && invokeCallback._store && !invokeCallback._store.validated && (escapedPrefix._store.validated = 2), callback = escapedPrefix), array.push(callback));
            return 1;
          }
          invokeCallback = 0;
          childKey = "" === nameSoFar ? "." : nameSoFar + ":";
          if (isArrayImpl(children))
            for (var i = 0; i < children.length; i++)
              nameSoFar = children[i], type = childKey + getElementKey(nameSoFar, i), invokeCallback += mapIntoArray(
                nameSoFar,
                array,
                escapedPrefix,
                type,
                callback
              );
          else if (i = getIteratorFn(children), "function" === typeof i)
            for (i === children.entries && (didWarnAboutMaps || console.warn(
              "Using Maps as children is not supported. Use an array of keyed ReactElements instead."
            ), didWarnAboutMaps = true), children = i.call(children), i = 0; !(nameSoFar = children.next()).done; )
              nameSoFar = nameSoFar.value, type = childKey + getElementKey(nameSoFar, i++), invokeCallback += mapIntoArray(
                nameSoFar,
                array,
                escapedPrefix,
                type,
                callback
              );
          else if ("object" === type) {
            if ("function" === typeof children.then)
              return mapIntoArray(
                resolveThenable(children),
                array,
                escapedPrefix,
                nameSoFar,
                callback
              );
            array = String(children);
            throw Error(
              "Objects are not valid as a React child (found: " + ("[object Object]" === array ? "object with keys {" + Object.keys(children).join(", ") + "}" : array) + "). If you meant to render a collection of children, use an array instead."
            );
          }
          return invokeCallback;
        }
        function mapChildren(children, func, context) {
          if (null == children) return children;
          var result = [], count = 0;
          mapIntoArray(children, result, "", "", function(child) {
            return func.call(context, child, count++);
          });
          return result;
        }
        function lazyInitializer(payload) {
          if (-1 === payload._status) {
            var ioInfo = payload._ioInfo;
            null != ioInfo && (ioInfo.start = ioInfo.end = performance.now());
            ioInfo = payload._result;
            var thenable = ioInfo();
            thenable.then(
              function(moduleObject) {
                if (0 === payload._status || -1 === payload._status) {
                  payload._status = 1;
                  payload._result = moduleObject;
                  var _ioInfo = payload._ioInfo;
                  null != _ioInfo && (_ioInfo.end = performance.now());
                  void 0 === thenable.status && (thenable.status = "fulfilled", thenable.value = moduleObject);
                }
              },
              function(error) {
                if (0 === payload._status || -1 === payload._status) {
                  payload._status = 2;
                  payload._result = error;
                  var _ioInfo2 = payload._ioInfo;
                  null != _ioInfo2 && (_ioInfo2.end = performance.now());
                  void 0 === thenable.status && (thenable.status = "rejected", thenable.reason = error);
                }
              }
            );
            ioInfo = payload._ioInfo;
            if (null != ioInfo) {
              ioInfo.value = thenable;
              var displayName = thenable.displayName;
              "string" === typeof displayName && (ioInfo.name = displayName);
            }
            -1 === payload._status && (payload._status = 0, payload._result = thenable);
          }
          if (1 === payload._status)
            return ioInfo = payload._result, void 0 === ioInfo && console.error(
              "lazy: Expected the result of a dynamic import() call. Instead received: %s\n\nYour code should look like: \n  const MyComponent = lazy(() => import('./MyComponent'))\n\nDid you accidentally put curly braces around the import?",
              ioInfo
            ), "default" in ioInfo || console.error(
              "lazy: Expected the result of a dynamic import() call. Instead received: %s\n\nYour code should look like: \n  const MyComponent = lazy(() => import('./MyComponent'))",
              ioInfo
            ), ioInfo.default;
          throw payload._result;
        }
        function resolveDispatcher() {
          var dispatcher = ReactSharedInternals.H;
          null === dispatcher && console.error(
            "Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for one of the following reasons:\n1. You might have mismatching versions of React and the renderer (such as React DOM)\n2. You might be breaking the Rules of Hooks\n3. You might have more than one copy of React in the same app\nSee https://react.dev/link/invalid-hook-call for tips about how to debug and fix this problem."
          );
          return dispatcher;
        }
        function releaseAsyncTransition() {
          ReactSharedInternals.asyncTransitions--;
        }
        function enqueueTask(task) {
          if (null === enqueueTaskImpl)
            try {
              var requireString = ("require" + Math.random()).slice(0, 7);
              enqueueTaskImpl = (module && module[requireString]).call(
                module,
                "timers"
              ).setImmediate;
            } catch (_err) {
              enqueueTaskImpl = function(callback) {
                false === didWarnAboutMessageChannel && (didWarnAboutMessageChannel = true, "undefined" === typeof MessageChannel && console.error(
                  "This browser does not have a MessageChannel implementation, so enqueuing tasks via await act(async () => ...) will fail. Please file an issue at https://github.com/facebook/react/issues if you encounter this warning."
                ));
                var channel = new MessageChannel();
                channel.port1.onmessage = callback;
                channel.port2.postMessage(void 0);
              };
            }
          return enqueueTaskImpl(task);
        }
        function aggregateErrors(errors) {
          return 1 < errors.length && "function" === typeof AggregateError ? new AggregateError(errors) : errors[0];
        }
        function popActScope(prevActQueue, prevActScopeDepth) {
          prevActScopeDepth !== actScopeDepth - 1 && console.error(
            "You seem to have overlapping act() calls, this is not supported. Be sure to await previous act() calls before making a new one. "
          );
          actScopeDepth = prevActScopeDepth;
        }
        function recursivelyFlushAsyncActWork(returnValue, resolve, reject) {
          var queue = ReactSharedInternals.actQueue;
          if (null !== queue)
            if (0 !== queue.length)
              try {
                flushActQueue(queue);
                enqueueTask(function() {
                  return recursivelyFlushAsyncActWork(returnValue, resolve, reject);
                });
                return;
              } catch (error) {
                ReactSharedInternals.thrownErrors.push(error);
              }
            else ReactSharedInternals.actQueue = null;
          0 < ReactSharedInternals.thrownErrors.length ? (queue = aggregateErrors(ReactSharedInternals.thrownErrors), ReactSharedInternals.thrownErrors.length = 0, reject(queue)) : resolve(returnValue);
        }
        function flushActQueue(queue) {
          if (!isFlushing) {
            isFlushing = true;
            var i = 0;
            try {
              for (; i < queue.length; i++) {
                var callback = queue[i];
                do {
                  ReactSharedInternals.didUsePromise = false;
                  var continuation = callback(false);
                  if (null !== continuation) {
                    if (ReactSharedInternals.didUsePromise) {
                      queue[i] = callback;
                      queue.splice(0, i);
                      return;
                    }
                    callback = continuation;
                  } else break;
                } while (1);
              }
              queue.length = 0;
            } catch (error) {
              queue.splice(0, i + 1), ReactSharedInternals.thrownErrors.push(error);
            } finally {
              isFlushing = false;
            }
          }
        }
        "undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ && "function" === typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart(Error());
        var REACT_ELEMENT_TYPE = /* @__PURE__ */ Symbol.for("react.transitional.element"), REACT_PORTAL_TYPE = /* @__PURE__ */ Symbol.for("react.portal"), REACT_FRAGMENT_TYPE = /* @__PURE__ */ Symbol.for("react.fragment"), REACT_STRICT_MODE_TYPE = /* @__PURE__ */ Symbol.for("react.strict_mode"), REACT_PROFILER_TYPE = /* @__PURE__ */ Symbol.for("react.profiler"), REACT_CONSUMER_TYPE = /* @__PURE__ */ Symbol.for("react.consumer"), REACT_CONTEXT_TYPE = /* @__PURE__ */ Symbol.for("react.context"), REACT_FORWARD_REF_TYPE = /* @__PURE__ */ Symbol.for("react.forward_ref"), REACT_SUSPENSE_TYPE = /* @__PURE__ */ Symbol.for("react.suspense"), REACT_SUSPENSE_LIST_TYPE = /* @__PURE__ */ Symbol.for("react.suspense_list"), REACT_MEMO_TYPE = /* @__PURE__ */ Symbol.for("react.memo"), REACT_LAZY_TYPE = /* @__PURE__ */ Symbol.for("react.lazy"), REACT_ACTIVITY_TYPE = /* @__PURE__ */ Symbol.for("react.activity"), MAYBE_ITERATOR_SYMBOL = Symbol.iterator, didWarnStateUpdateForUnmountedComponent = {}, ReactNoopUpdateQueue = {
          isMounted: function() {
            return false;
          },
          enqueueForceUpdate: function(publicInstance) {
            warnNoop(publicInstance, "forceUpdate");
          },
          enqueueReplaceState: function(publicInstance) {
            warnNoop(publicInstance, "replaceState");
          },
          enqueueSetState: function(publicInstance) {
            warnNoop(publicInstance, "setState");
          }
        }, assign = Object.assign, emptyObject = {};
        Object.freeze(emptyObject);
        Component.prototype.isReactComponent = {};
        Component.prototype.setState = function(partialState, callback) {
          if ("object" !== typeof partialState && "function" !== typeof partialState && null != partialState)
            throw Error(
              "takes an object of state variables to update or a function which returns an object of state variables."
            );
          this.updater.enqueueSetState(this, partialState, callback, "setState");
        };
        Component.prototype.forceUpdate = function(callback) {
          this.updater.enqueueForceUpdate(this, callback, "forceUpdate");
        };
        var deprecatedAPIs = {
          isMounted: [
            "isMounted",
            "Instead, make sure to clean up subscriptions and pending requests in componentWillUnmount to prevent memory leaks."
          ],
          replaceState: [
            "replaceState",
            "Refactor your code to use setState instead (see https://github.com/facebook/react/issues/3236)."
          ]
        };
        for (fnName in deprecatedAPIs)
          deprecatedAPIs.hasOwnProperty(fnName) && defineDeprecationWarning(fnName, deprecatedAPIs[fnName]);
        ComponentDummy.prototype = Component.prototype;
        deprecatedAPIs = PureComponent.prototype = new ComponentDummy();
        deprecatedAPIs.constructor = PureComponent;
        assign(deprecatedAPIs, Component.prototype);
        deprecatedAPIs.isPureReactComponent = true;
        var isArrayImpl = Array.isArray, REACT_CLIENT_REFERENCE = /* @__PURE__ */ Symbol.for("react.client.reference"), ReactSharedInternals = {
          H: null,
          A: null,
          T: null,
          S: null,
          actQueue: null,
          asyncTransitions: 0,
          isBatchingLegacy: false,
          didScheduleLegacyUpdate: false,
          didUsePromise: false,
          thrownErrors: [],
          getCurrentStack: null,
          recentlyCreatedOwnerStacks: 0
        }, hasOwnProperty = Object.prototype.hasOwnProperty, createTask = console.createTask ? console.createTask : function() {
          return null;
        };
        deprecatedAPIs = {
          react_stack_bottom_frame: function(callStackForError) {
            return callStackForError();
          }
        };
        var specialPropKeyWarningShown, didWarnAboutOldJSXRuntime;
        var didWarnAboutElementRef = {};
        var unknownOwnerDebugStack = deprecatedAPIs.react_stack_bottom_frame.bind(
          deprecatedAPIs,
          UnknownOwner
        )();
        var unknownOwnerDebugTask = createTask(getTaskName(UnknownOwner));
        var didWarnAboutMaps = false, userProvidedKeyEscapeRegex = /\/+/g, reportGlobalError = "function" === typeof reportError ? reportError : function(error) {
          if ("object" === typeof window && "function" === typeof window.ErrorEvent) {
            var event = new window.ErrorEvent("error", {
              bubbles: true,
              cancelable: true,
              message: "object" === typeof error && null !== error && "string" === typeof error.message ? String(error.message) : String(error),
              error
            });
            if (!window.dispatchEvent(event)) return;
          } else if ("object" === typeof process && "function" === typeof process.emit) {
            process.emit("uncaughtException", error);
            return;
          }
          console.error(error);
        }, didWarnAboutMessageChannel = false, enqueueTaskImpl = null, actScopeDepth = 0, didWarnNoAwaitAct = false, isFlushing = false, queueSeveralMicrotasks = "function" === typeof queueMicrotask ? function(callback) {
          queueMicrotask(function() {
            return queueMicrotask(callback);
          });
        } : enqueueTask;
        deprecatedAPIs = Object.freeze({
          __proto__: null,
          c: function(size) {
            return resolveDispatcher().useMemoCache(size);
          }
        });
        var fnName = {
          map: mapChildren,
          forEach: function(children, forEachFunc, forEachContext) {
            mapChildren(
              children,
              function() {
                forEachFunc.apply(this, arguments);
              },
              forEachContext
            );
          },
          count: function(children) {
            var n = 0;
            mapChildren(children, function() {
              n++;
            });
            return n;
          },
          toArray: function(children) {
            return mapChildren(children, function(child) {
              return child;
            }) || [];
          },
          only: function(children) {
            if (!isValidElement(children))
              throw Error(
                "React.Children.only expected to receive a single React element child."
              );
            return children;
          }
        };
        exports.Activity = REACT_ACTIVITY_TYPE;
        exports.Children = fnName;
        exports.Component = Component;
        exports.Fragment = REACT_FRAGMENT_TYPE;
        exports.Profiler = REACT_PROFILER_TYPE;
        exports.PureComponent = PureComponent;
        exports.StrictMode = REACT_STRICT_MODE_TYPE;
        exports.Suspense = REACT_SUSPENSE_TYPE;
        exports.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = ReactSharedInternals;
        exports.__COMPILER_RUNTIME = deprecatedAPIs;
        exports.act = function(callback) {
          var prevActQueue = ReactSharedInternals.actQueue, prevActScopeDepth = actScopeDepth;
          actScopeDepth++;
          var queue = ReactSharedInternals.actQueue = null !== prevActQueue ? prevActQueue : [], didAwaitActCall = false;
          try {
            var result = callback();
          } catch (error) {
            ReactSharedInternals.thrownErrors.push(error);
          }
          if (0 < ReactSharedInternals.thrownErrors.length)
            throw popActScope(prevActQueue, prevActScopeDepth), callback = aggregateErrors(ReactSharedInternals.thrownErrors), ReactSharedInternals.thrownErrors.length = 0, callback;
          if (null !== result && "object" === typeof result && "function" === typeof result.then) {
            var thenable = result;
            queueSeveralMicrotasks(function() {
              didAwaitActCall || didWarnNoAwaitAct || (didWarnNoAwaitAct = true, console.error(
                "You called act(async () => ...) without await. This could lead to unexpected testing behaviour, interleaving multiple act calls and mixing their scopes. You should - await act(async () => ...);"
              ));
            });
            return {
              then: function(resolve, reject) {
                didAwaitActCall = true;
                thenable.then(
                  function(returnValue) {
                    popActScope(prevActQueue, prevActScopeDepth);
                    if (0 === prevActScopeDepth) {
                      try {
                        flushActQueue(queue), enqueueTask(function() {
                          return recursivelyFlushAsyncActWork(
                            returnValue,
                            resolve,
                            reject
                          );
                        });
                      } catch (error$0) {
                        ReactSharedInternals.thrownErrors.push(error$0);
                      }
                      if (0 < ReactSharedInternals.thrownErrors.length) {
                        var _thrownError = aggregateErrors(
                          ReactSharedInternals.thrownErrors
                        );
                        ReactSharedInternals.thrownErrors.length = 0;
                        reject(_thrownError);
                      }
                    } else resolve(returnValue);
                  },
                  function(error) {
                    popActScope(prevActQueue, prevActScopeDepth);
                    0 < ReactSharedInternals.thrownErrors.length ? (error = aggregateErrors(
                      ReactSharedInternals.thrownErrors
                    ), ReactSharedInternals.thrownErrors.length = 0, reject(error)) : reject(error);
                  }
                );
              }
            };
          }
          var returnValue$jscomp$0 = result;
          popActScope(prevActQueue, prevActScopeDepth);
          0 === prevActScopeDepth && (flushActQueue(queue), 0 !== queue.length && queueSeveralMicrotasks(function() {
            didAwaitActCall || didWarnNoAwaitAct || (didWarnNoAwaitAct = true, console.error(
              "A component suspended inside an `act` scope, but the `act` call was not awaited. When testing React components that depend on asynchronous data, you must await the result:\n\nawait act(() => ...)"
            ));
          }), ReactSharedInternals.actQueue = null);
          if (0 < ReactSharedInternals.thrownErrors.length)
            throw callback = aggregateErrors(ReactSharedInternals.thrownErrors), ReactSharedInternals.thrownErrors.length = 0, callback;
          return {
            then: function(resolve, reject) {
              didAwaitActCall = true;
              0 === prevActScopeDepth ? (ReactSharedInternals.actQueue = queue, enqueueTask(function() {
                return recursivelyFlushAsyncActWork(
                  returnValue$jscomp$0,
                  resolve,
                  reject
                );
              })) : resolve(returnValue$jscomp$0);
            }
          };
        };
        exports.cache = function(fn) {
          return function() {
            return fn.apply(null, arguments);
          };
        };
        exports.cacheSignal = function() {
          return null;
        };
        exports.captureOwnerStack = function() {
          var getCurrentStack = ReactSharedInternals.getCurrentStack;
          return null === getCurrentStack ? null : getCurrentStack();
        };
        exports.cloneElement = function(element, config, children) {
          if (null === element || void 0 === element)
            throw Error(
              "The argument must be a React element, but you passed " + element + "."
            );
          var props = assign({}, element.props), key = element.key, owner = element._owner;
          if (null != config) {
            var JSCompiler_inline_result;
            a: {
              if (hasOwnProperty.call(config, "ref") && (JSCompiler_inline_result = Object.getOwnPropertyDescriptor(
                config,
                "ref"
              ).get) && JSCompiler_inline_result.isReactWarning) {
                JSCompiler_inline_result = false;
                break a;
              }
              JSCompiler_inline_result = void 0 !== config.ref;
            }
            JSCompiler_inline_result && (owner = getOwner());
            hasValidKey(config) && (checkKeyStringCoercion(config.key), key = "" + config.key);
            for (propName in config)
              !hasOwnProperty.call(config, propName) || "key" === propName || "__self" === propName || "__source" === propName || "ref" === propName && void 0 === config.ref || (props[propName] = config[propName]);
          }
          var propName = arguments.length - 2;
          if (1 === propName) props.children = children;
          else if (1 < propName) {
            JSCompiler_inline_result = Array(propName);
            for (var i = 0; i < propName; i++)
              JSCompiler_inline_result[i] = arguments[i + 2];
            props.children = JSCompiler_inline_result;
          }
          props = ReactElement(
            element.type,
            key,
            props,
            owner,
            element._debugStack,
            element._debugTask
          );
          for (key = 2; key < arguments.length; key++)
            validateChildKeys(arguments[key]);
          return props;
        };
        exports.createContext = function(defaultValue) {
          defaultValue = {
            $$typeof: REACT_CONTEXT_TYPE,
            _currentValue: defaultValue,
            _currentValue2: defaultValue,
            _threadCount: 0,
            Provider: null,
            Consumer: null
          };
          defaultValue.Provider = defaultValue;
          defaultValue.Consumer = {
            $$typeof: REACT_CONSUMER_TYPE,
            _context: defaultValue
          };
          defaultValue._currentRenderer = null;
          defaultValue._currentRenderer2 = null;
          return defaultValue;
        };
        exports.createElement = function(type, config, children) {
          for (var i = 2; i < arguments.length; i++)
            validateChildKeys(arguments[i]);
          i = {};
          var key = null;
          if (null != config)
            for (propName in didWarnAboutOldJSXRuntime || !("__self" in config) || "key" in config || (didWarnAboutOldJSXRuntime = true, console.warn(
              "Your app (or one of its dependencies) is using an outdated JSX transform. Update to the modern JSX transform for faster performance: https://react.dev/link/new-jsx-transform"
            )), hasValidKey(config) && (checkKeyStringCoercion(config.key), key = "" + config.key), config)
              hasOwnProperty.call(config, propName) && "key" !== propName && "__self" !== propName && "__source" !== propName && (i[propName] = config[propName]);
          var childrenLength = arguments.length - 2;
          if (1 === childrenLength) i.children = children;
          else if (1 < childrenLength) {
            for (var childArray = Array(childrenLength), _i = 0; _i < childrenLength; _i++)
              childArray[_i] = arguments[_i + 2];
            Object.freeze && Object.freeze(childArray);
            i.children = childArray;
          }
          if (type && type.defaultProps)
            for (propName in childrenLength = type.defaultProps, childrenLength)
              void 0 === i[propName] && (i[propName] = childrenLength[propName]);
          key && defineKeyPropWarningGetter(
            i,
            "function" === typeof type ? type.displayName || type.name || "Unknown" : type
          );
          var propName = 1e4 > ReactSharedInternals.recentlyCreatedOwnerStacks++;
          return ReactElement(
            type,
            key,
            i,
            getOwner(),
            propName ? Error("react-stack-top-frame") : unknownOwnerDebugStack,
            propName ? createTask(getTaskName(type)) : unknownOwnerDebugTask
          );
        };
        exports.createRef = function() {
          var refObject = { current: null };
          Object.seal(refObject);
          return refObject;
        };
        exports.forwardRef = function(render) {
          null != render && render.$$typeof === REACT_MEMO_TYPE ? console.error(
            "forwardRef requires a render function but received a `memo` component. Instead of forwardRef(memo(...)), use memo(forwardRef(...))."
          ) : "function" !== typeof render ? console.error(
            "forwardRef requires a render function but was given %s.",
            null === render ? "null" : typeof render
          ) : 0 !== render.length && 2 !== render.length && console.error(
            "forwardRef render functions accept exactly two parameters: props and ref. %s",
            1 === render.length ? "Did you forget to use the ref parameter?" : "Any additional parameter will be undefined."
          );
          null != render && null != render.defaultProps && console.error(
            "forwardRef render functions do not support defaultProps. Did you accidentally pass a React component?"
          );
          var elementType = { $$typeof: REACT_FORWARD_REF_TYPE, render }, ownName;
          Object.defineProperty(elementType, "displayName", {
            enumerable: false,
            configurable: true,
            get: function() {
              return ownName;
            },
            set: function(name) {
              ownName = name;
              render.name || render.displayName || (Object.defineProperty(render, "name", { value: name }), render.displayName = name);
            }
          });
          return elementType;
        };
        exports.isValidElement = isValidElement;
        exports.lazy = function(ctor) {
          ctor = { _status: -1, _result: ctor };
          var lazyType = {
            $$typeof: REACT_LAZY_TYPE,
            _payload: ctor,
            _init: lazyInitializer
          }, ioInfo = {
            name: "lazy",
            start: -1,
            end: -1,
            value: null,
            owner: null,
            debugStack: Error("react-stack-top-frame"),
            debugTask: console.createTask ? console.createTask("lazy()") : null
          };
          ctor._ioInfo = ioInfo;
          lazyType._debugInfo = [{ awaited: ioInfo }];
          return lazyType;
        };
        exports.memo = function(type, compare) {
          null == type && console.error(
            "memo: The first argument must be a component. Instead received: %s",
            null === type ? "null" : typeof type
          );
          compare = {
            $$typeof: REACT_MEMO_TYPE,
            type,
            compare: void 0 === compare ? null : compare
          };
          var ownName;
          Object.defineProperty(compare, "displayName", {
            enumerable: false,
            configurable: true,
            get: function() {
              return ownName;
            },
            set: function(name) {
              ownName = name;
              type.name || type.displayName || (Object.defineProperty(type, "name", { value: name }), type.displayName = name);
            }
          });
          return compare;
        };
        exports.startTransition = function(scope) {
          var prevTransition = ReactSharedInternals.T, currentTransition = {};
          currentTransition._updatedFibers = /* @__PURE__ */ new Set();
          ReactSharedInternals.T = currentTransition;
          try {
            var returnValue = scope(), onStartTransitionFinish = ReactSharedInternals.S;
            null !== onStartTransitionFinish && onStartTransitionFinish(currentTransition, returnValue);
            "object" === typeof returnValue && null !== returnValue && "function" === typeof returnValue.then && (ReactSharedInternals.asyncTransitions++, returnValue.then(releaseAsyncTransition, releaseAsyncTransition), returnValue.then(noop, reportGlobalError));
          } catch (error) {
            reportGlobalError(error);
          } finally {
            null === prevTransition && currentTransition._updatedFibers && (scope = currentTransition._updatedFibers.size, currentTransition._updatedFibers.clear(), 10 < scope && console.warn(
              "Detected a large number of updates inside startTransition. If this is due to a subscription please re-write it to use React provided hooks. Otherwise concurrent mode guarantees are off the table."
            )), null !== prevTransition && null !== currentTransition.types && (null !== prevTransition.types && prevTransition.types !== currentTransition.types && console.error(
              "We expected inner Transitions to have transferred the outer types set and that you cannot add to the outer Transition while inside the inner.This is a bug in React."
            ), prevTransition.types = currentTransition.types), ReactSharedInternals.T = prevTransition;
          }
        };
        exports.unstable_useCacheRefresh = function() {
          return resolveDispatcher().useCacheRefresh();
        };
        exports.use = function(usable) {
          return resolveDispatcher().use(usable);
        };
        exports.useActionState = function(action, initialState, permalink) {
          return resolveDispatcher().useActionState(
            action,
            initialState,
            permalink
          );
        };
        exports.useCallback = function(callback, deps) {
          return resolveDispatcher().useCallback(callback, deps);
        };
        exports.useContext = function(Context) {
          var dispatcher = resolveDispatcher();
          Context.$$typeof === REACT_CONSUMER_TYPE && console.error(
            "Calling useContext(Context.Consumer) is not supported and will cause bugs. Did you mean to call useContext(Context) instead?"
          );
          return dispatcher.useContext(Context);
        };
        exports.useDebugValue = function(value, formatterFn) {
          return resolveDispatcher().useDebugValue(value, formatterFn);
        };
        exports.useDeferredValue = function(value, initialValue) {
          return resolveDispatcher().useDeferredValue(value, initialValue);
        };
        exports.useEffect = function(create, deps) {
          null == create && console.warn(
            "React Hook useEffect requires an effect callback. Did you forget to pass a callback to the hook?"
          );
          return resolveDispatcher().useEffect(create, deps);
        };
        exports.useEffectEvent = function(callback) {
          return resolveDispatcher().useEffectEvent(callback);
        };
        exports.useId = function() {
          return resolveDispatcher().useId();
        };
        exports.useImperativeHandle = function(ref, create, deps) {
          return resolveDispatcher().useImperativeHandle(ref, create, deps);
        };
        exports.useInsertionEffect = function(create, deps) {
          null == create && console.warn(
            "React Hook useInsertionEffect requires an effect callback. Did you forget to pass a callback to the hook?"
          );
          return resolveDispatcher().useInsertionEffect(create, deps);
        };
        exports.useLayoutEffect = function(create, deps) {
          null == create && console.warn(
            "React Hook useLayoutEffect requires an effect callback. Did you forget to pass a callback to the hook?"
          );
          return resolveDispatcher().useLayoutEffect(create, deps);
        };
        exports.useMemo = function(create, deps) {
          return resolveDispatcher().useMemo(create, deps);
        };
        exports.useOptimistic = function(passthrough, reducer) {
          return resolveDispatcher().useOptimistic(passthrough, reducer);
        };
        exports.useReducer = function(reducer, initialArg, init) {
          return resolveDispatcher().useReducer(reducer, initialArg, init);
        };
        exports.useRef = function(initialValue) {
          return resolveDispatcher().useRef(initialValue);
        };
        exports.useState = function(initialState) {
          return resolveDispatcher().useState(initialState);
        };
        exports.useSyncExternalStore = function(subscribe2, getSnapshot, getServerSnapshot) {
          return resolveDispatcher().useSyncExternalStore(
            subscribe2,
            getSnapshot,
            getServerSnapshot
          );
        };
        exports.useTransition = function() {
          return resolveDispatcher().useTransition();
        };
        exports.version = "19.2.6";
        "undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ && "function" === typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop(Error());
      })();
    }
  });

  // ../../node_modules/react/index.js
  var require_react = __commonJS({
    "../../node_modules/react/index.js"(exports, module) {
      "use strict";
      if (process.env.NODE_ENV === "production") {
        module.exports = require_react_production();
      } else {
        module.exports = require_react_development();
      }
    }
  });

  // runtime/theme_presets.ts
  function findTheme(name) {
    const lower = name.toLowerCase();
    for (const t of themes) {
      if (t.name.toLowerCase() === lower) return t;
    }
    return null;
  }
  var rgb, rounded_airy, catppuccin_mocha_styles, dracula_styles, tokyo_night_styles, nord_styles, solarized_dark_styles, gruvbox_dark_styles, bios_styles, win95_styles, winamp_styles, glass_styles, catppuccin_mocha, catppuccin_macchiato, catppuccin_frappe, catppuccin_latte, dracula, dracula_soft, gruvbox_dark, gruvbox_light, nord, nord_light, one_dark, rose_pine, rose_pine_dawn, solarized_dark, solarized_light, tokyo_night, tokyo_night_storm, bios, win95, winamp, glass, themes;
  var init_theme_presets = __esm({
    "runtime/theme_presets.ts"() {
      rgb = (r, g, b) => "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
      rounded_airy = {
        radiusSm: 4,
        radiusMd: 8,
        radiusLg: 16,
        spacingSm: 8,
        spacingMd: 16,
        spacingLg: 24,
        borderThin: 1,
        borderMedium: 2,
        fontSm: 11,
        fontMd: 13,
        fontLg: 18
      };
      catppuccin_mocha_styles = {
        radiusSm: 6,
        radiusMd: 8,
        radiusLg: 12,
        spacingSm: 6,
        spacingMd: 10,
        spacingLg: 14,
        borderThin: 1,
        borderMedium: 1,
        fontSm: 12,
        fontMd: 14,
        fontLg: 17
      };
      dracula_styles = {
        radiusSm: 4,
        radiusMd: 6,
        radiusLg: 10,
        spacingSm: 6,
        spacingMd: 10,
        spacingLg: 16,
        borderThin: 1,
        borderMedium: 2,
        fontSm: 12,
        fontMd: 14,
        fontLg: 18
      };
      tokyo_night_styles = {
        radiusSm: 3,
        radiusMd: 5,
        radiusLg: 8,
        spacingSm: 4,
        spacingMd: 8,
        spacingLg: 12,
        borderThin: 1,
        borderMedium: 1,
        fontSm: 12,
        fontMd: 14,
        fontLg: 16
      };
      nord_styles = {
        radiusSm: 4,
        radiusMd: 6,
        radiusLg: 10,
        spacingSm: 6,
        spacingMd: 10,
        spacingLg: 14,
        borderThin: 1,
        borderMedium: 1,
        fontSm: 12,
        fontMd: 14,
        fontLg: 17
      };
      solarized_dark_styles = {
        radiusSm: 3,
        radiusMd: 5,
        radiusLg: 8,
        spacingSm: 6,
        spacingMd: 10,
        spacingLg: 16,
        borderThin: 1,
        borderMedium: 2,
        fontSm: 12,
        fontMd: 14,
        fontLg: 18
      };
      gruvbox_dark_styles = {
        radiusSm: 4,
        radiusMd: 6,
        radiusLg: 10,
        spacingSm: 6,
        spacingMd: 10,
        spacingLg: 16,
        borderThin: 1,
        borderMedium: 2,
        fontSm: 12,
        fontMd: 14,
        fontLg: 18
      };
      bios_styles = {
        radiusSm: 0,
        radiusMd: 0,
        radiusLg: 0,
        spacingSm: 4,
        spacingMd: 8,
        spacingLg: 12,
        borderThin: 1,
        borderMedium: 1,
        fontSm: 12,
        fontMd: 14,
        fontLg: 16
      };
      win95_styles = {
        radiusSm: 0,
        radiusMd: 0,
        radiusLg: 0,
        spacingSm: 4,
        spacingMd: 6,
        spacingLg: 10,
        borderThin: 2,
        borderMedium: 3,
        fontSm: 11,
        fontMd: 13,
        fontLg: 16
      };
      winamp_styles = {
        radiusSm: 1,
        radiusMd: 2,
        radiusLg: 3,
        spacingSm: 2,
        spacingMd: 4,
        spacingLg: 8,
        borderThin: 1,
        borderMedium: 1,
        fontSm: 10,
        fontMd: 12,
        fontLg: 14
      };
      glass_styles = {
        radiusSm: 8,
        radiusMd: 12,
        radiusLg: 16,
        spacingSm: 6,
        spacingMd: 10,
        spacingLg: 16,
        borderThin: 1,
        borderMedium: 1,
        fontSm: 12,
        fontMd: 14,
        fontLg: 18
      };
      catppuccin_mocha = {
        bg: rgb(30, 30, 46),
        bgAlt: rgb(24, 24, 37),
        bgElevated: rgb(49, 50, 68),
        surface: rgb(49, 50, 68),
        surfaceHover: rgb(69, 71, 90),
        border: rgb(69, 71, 90),
        borderFocus: rgb(137, 180, 250),
        text: rgb(205, 214, 244),
        textSecondary: rgb(186, 194, 222),
        textDim: rgb(166, 173, 200),
        primary: rgb(137, 180, 250),
        primaryHover: rgb(116, 199, 236),
        primaryPressed: rgb(137, 220, 235),
        accent: rgb(203, 166, 247),
        error: rgb(243, 139, 168),
        warning: rgb(250, 179, 135),
        success: rgb(166, 227, 161),
        info: rgb(137, 220, 235)
      };
      catppuccin_macchiato = {
        bg: rgb(36, 39, 58),
        bgAlt: rgb(30, 32, 48),
        bgElevated: rgb(54, 58, 79),
        surface: rgb(54, 58, 79),
        surfaceHover: rgb(73, 77, 100),
        border: rgb(73, 77, 100),
        borderFocus: rgb(138, 173, 244),
        text: rgb(202, 211, 245),
        textSecondary: rgb(184, 192, 224),
        textDim: rgb(165, 173, 203),
        primary: rgb(138, 173, 244),
        primaryHover: rgb(125, 196, 228),
        primaryPressed: rgb(145, 215, 227),
        accent: rgb(198, 160, 246),
        error: rgb(237, 135, 150),
        warning: rgb(245, 169, 127),
        success: rgb(166, 218, 149),
        info: rgb(145, 215, 227)
      };
      catppuccin_frappe = {
        bg: rgb(48, 52, 70),
        bgAlt: rgb(41, 44, 60),
        bgElevated: rgb(65, 69, 89),
        surface: rgb(65, 69, 89),
        surfaceHover: rgb(81, 87, 109),
        border: rgb(81, 87, 109),
        borderFocus: rgb(140, 170, 238),
        text: rgb(198, 208, 245),
        textSecondary: rgb(181, 191, 226),
        textDim: rgb(165, 173, 206),
        primary: rgb(140, 170, 238),
        primaryHover: rgb(133, 193, 220),
        primaryPressed: rgb(153, 209, 219),
        accent: rgb(202, 158, 230),
        error: rgb(231, 130, 132),
        warning: rgb(239, 159, 118),
        success: rgb(166, 209, 137),
        info: rgb(153, 209, 219)
      };
      catppuccin_latte = {
        bg: rgb(239, 241, 245),
        bgAlt: rgb(230, 233, 239),
        bgElevated: rgb(204, 208, 218),
        surface: rgb(204, 208, 218),
        surfaceHover: rgb(188, 192, 204),
        border: rgb(188, 192, 204),
        borderFocus: rgb(30, 102, 245),
        text: rgb(76, 79, 105),
        textSecondary: rgb(92, 95, 119),
        textDim: rgb(108, 111, 133),
        primary: rgb(30, 102, 245),
        primaryHover: rgb(32, 159, 181),
        primaryPressed: rgb(4, 165, 229),
        accent: rgb(136, 57, 239),
        error: rgb(210, 15, 57),
        warning: rgb(254, 100, 11),
        success: rgb(64, 160, 43),
        info: rgb(4, 165, 229)
      };
      dracula = {
        bg: rgb(40, 42, 54),
        bgAlt: rgb(33, 34, 44),
        bgElevated: rgb(68, 71, 90),
        surface: rgb(68, 71, 90),
        surfaceHover: rgb(77, 80, 94),
        border: rgb(68, 71, 90),
        borderFocus: rgb(189, 147, 249),
        text: rgb(248, 248, 242),
        textSecondary: rgb(191, 191, 191),
        textDim: rgb(98, 114, 164),
        primary: rgb(189, 147, 249),
        primaryHover: rgb(202, 164, 250),
        primaryPressed: rgb(212, 181, 251),
        accent: rgb(255, 121, 198),
        error: rgb(255, 85, 85),
        warning: rgb(255, 184, 108),
        success: rgb(80, 250, 123),
        info: rgb(139, 233, 253)
      };
      dracula_soft = {
        bg: rgb(45, 47, 63),
        bgAlt: rgb(37, 39, 55),
        bgElevated: rgb(68, 71, 90),
        surface: rgb(68, 71, 90),
        surfaceHover: rgb(77, 80, 94),
        border: rgb(68, 71, 90),
        borderFocus: rgb(189, 147, 249),
        text: rgb(242, 242, 232),
        textSecondary: rgb(184, 184, 176),
        textDim: rgb(98, 114, 164),
        primary: rgb(189, 147, 249),
        primaryHover: rgb(202, 164, 250),
        primaryPressed: rgb(212, 181, 251),
        accent: rgb(255, 121, 198),
        error: rgb(255, 85, 85),
        warning: rgb(255, 184, 108),
        success: rgb(80, 250, 123),
        info: rgb(139, 233, 253)
      };
      gruvbox_dark = {
        bg: rgb(40, 40, 40),
        bgAlt: rgb(60, 56, 54),
        bgElevated: rgb(80, 73, 69),
        surface: rgb(60, 56, 54),
        surfaceHover: rgb(80, 73, 69),
        border: rgb(80, 73, 69),
        borderFocus: rgb(131, 165, 152),
        text: rgb(235, 219, 178),
        textSecondary: rgb(213, 196, 161),
        textDim: rgb(146, 131, 116),
        primary: rgb(131, 165, 152),
        primaryHover: rgb(142, 192, 124),
        primaryPressed: rgb(184, 187, 38),
        accent: rgb(211, 134, 155),
        error: rgb(251, 73, 52),
        warning: rgb(254, 128, 25),
        success: rgb(184, 187, 38),
        info: rgb(131, 165, 152)
      };
      gruvbox_light = {
        bg: rgb(251, 241, 199),
        bgAlt: rgb(235, 219, 178),
        bgElevated: rgb(213, 196, 161),
        surface: rgb(235, 219, 178),
        surfaceHover: rgb(213, 196, 161),
        border: rgb(213, 196, 161),
        borderFocus: rgb(7, 102, 120),
        text: rgb(60, 56, 54),
        textSecondary: rgb(80, 73, 69),
        textDim: rgb(146, 131, 116),
        primary: rgb(7, 102, 120),
        primaryHover: rgb(66, 123, 88),
        primaryPressed: rgb(121, 116, 14),
        accent: rgb(143, 63, 113),
        error: rgb(157, 0, 6),
        warning: rgb(175, 58, 3),
        success: rgb(121, 116, 14),
        info: rgb(7, 102, 120)
      };
      nord = {
        bg: rgb(46, 52, 64),
        bgAlt: rgb(59, 66, 82),
        bgElevated: rgb(67, 76, 94),
        surface: rgb(59, 66, 82),
        surfaceHover: rgb(67, 76, 94),
        border: rgb(67, 76, 94),
        borderFocus: rgb(136, 192, 208),
        text: rgb(236, 239, 244),
        textSecondary: rgb(216, 222, 233),
        textDim: rgb(76, 86, 106),
        primary: rgb(136, 192, 208),
        primaryHover: rgb(143, 188, 187),
        primaryPressed: rgb(129, 161, 193),
        accent: rgb(180, 142, 173),
        error: rgb(191, 97, 106),
        warning: rgb(208, 135, 112),
        success: rgb(163, 190, 140),
        info: rgb(94, 129, 172)
      };
      nord_light = {
        bg: rgb(236, 239, 244),
        bgAlt: rgb(229, 233, 240),
        bgElevated: rgb(216, 222, 233),
        surface: rgb(216, 222, 233),
        surfaceHover: rgb(229, 233, 240),
        border: rgb(216, 222, 233),
        borderFocus: rgb(94, 129, 172),
        text: rgb(46, 52, 64),
        textSecondary: rgb(59, 66, 82),
        textDim: rgb(76, 86, 106),
        primary: rgb(94, 129, 172),
        primaryHover: rgb(129, 161, 193),
        primaryPressed: rgb(136, 192, 208),
        accent: rgb(180, 142, 173),
        error: rgb(191, 97, 106),
        warning: rgb(208, 135, 112),
        success: rgb(163, 190, 140),
        info: rgb(94, 129, 172)
      };
      one_dark = {
        bg: rgb(40, 44, 52),
        bgAlt: rgb(33, 37, 43),
        bgElevated: rgb(44, 49, 58),
        surface: rgb(44, 49, 58),
        surfaceHover: rgb(51, 56, 66),
        border: rgb(62, 68, 82),
        borderFocus: rgb(97, 175, 239),
        text: rgb(171, 178, 191),
        textSecondary: rgb(157, 165, 180),
        textDim: rgb(92, 99, 112),
        primary: rgb(97, 175, 239),
        primaryHover: rgb(86, 182, 194),
        primaryPressed: rgb(152, 195, 121),
        accent: rgb(198, 120, 221),
        error: rgb(224, 108, 117),
        warning: rgb(209, 154, 102),
        success: rgb(152, 195, 121),
        info: rgb(86, 182, 194)
      };
      rose_pine = {
        bg: rgb(25, 23, 36),
        bgAlt: rgb(31, 29, 46),
        bgElevated: rgb(38, 35, 58),
        surface: rgb(31, 29, 46),
        surfaceHover: rgb(38, 35, 58),
        border: rgb(38, 35, 58),
        borderFocus: rgb(49, 116, 143),
        text: rgb(224, 222, 244),
        textSecondary: rgb(144, 140, 170),
        textDim: rgb(110, 106, 134),
        primary: rgb(49, 116, 143),
        primaryHover: rgb(156, 207, 216),
        primaryPressed: rgb(235, 188, 186),
        accent: rgb(196, 167, 231),
        error: rgb(235, 111, 146),
        warning: rgb(246, 193, 119),
        success: rgb(49, 116, 143),
        info: rgb(156, 207, 216)
      };
      rose_pine_dawn = {
        bg: rgb(250, 244, 237),
        bgAlt: rgb(255, 250, 243),
        bgElevated: rgb(242, 233, 225),
        surface: rgb(255, 250, 243),
        surfaceHover: rgb(242, 233, 225),
        border: rgb(223, 218, 217),
        borderFocus: rgb(40, 105, 131),
        text: rgb(87, 82, 121),
        textSecondary: rgb(121, 117, 147),
        textDim: rgb(152, 147, 165),
        primary: rgb(40, 105, 131),
        primaryHover: rgb(86, 148, 159),
        primaryPressed: rgb(215, 130, 126),
        accent: rgb(144, 122, 169),
        error: rgb(180, 99, 122),
        warning: rgb(234, 157, 52),
        success: rgb(40, 105, 131),
        info: rgb(86, 148, 159)
      };
      solarized_dark = {
        bg: rgb(0, 43, 54),
        bgAlt: rgb(7, 54, 66),
        bgElevated: rgb(7, 54, 66),
        surface: rgb(7, 54, 66),
        surfaceHover: rgb(7, 54, 66),
        border: rgb(88, 110, 117),
        borderFocus: rgb(38, 139, 210),
        text: rgb(131, 148, 150),
        textSecondary: rgb(147, 161, 161),
        textDim: rgb(88, 110, 117),
        primary: rgb(38, 139, 210),
        primaryHover: rgb(42, 161, 152),
        primaryPressed: rgb(133, 153, 0),
        accent: rgb(108, 113, 196),
        error: rgb(220, 50, 47),
        warning: rgb(203, 75, 22),
        success: rgb(133, 153, 0),
        info: rgb(42, 161, 152)
      };
      solarized_light = {
        bg: rgb(253, 246, 227),
        bgAlt: rgb(238, 232, 213),
        bgElevated: rgb(238, 232, 213),
        surface: rgb(238, 232, 213),
        surfaceHover: rgb(238, 232, 213),
        border: rgb(147, 161, 161),
        borderFocus: rgb(38, 139, 210),
        text: rgb(101, 123, 131),
        textSecondary: rgb(88, 110, 117),
        textDim: rgb(147, 161, 161),
        primary: rgb(38, 139, 210),
        primaryHover: rgb(42, 161, 152),
        primaryPressed: rgb(133, 153, 0),
        accent: rgb(108, 113, 196),
        error: rgb(220, 50, 47),
        warning: rgb(203, 75, 22),
        success: rgb(133, 153, 0),
        info: rgb(42, 161, 152)
      };
      tokyo_night = {
        bg: rgb(26, 27, 38),
        bgAlt: rgb(22, 22, 30),
        bgElevated: rgb(36, 40, 59),
        surface: rgb(36, 40, 59),
        surfaceHover: rgb(41, 46, 66),
        border: rgb(41, 46, 66),
        borderFocus: rgb(122, 162, 247),
        text: rgb(192, 202, 245),
        textSecondary: rgb(169, 177, 214),
        textDim: rgb(86, 95, 137),
        primary: rgb(122, 162, 247),
        primaryHover: rgb(125, 207, 255),
        primaryPressed: rgb(42, 195, 222),
        accent: rgb(187, 154, 247),
        error: rgb(247, 118, 142),
        warning: rgb(224, 175, 104),
        success: rgb(158, 206, 106),
        info: rgb(125, 207, 255)
      };
      tokyo_night_storm = {
        bg: rgb(36, 40, 59),
        bgAlt: rgb(31, 35, 53),
        bgElevated: rgb(41, 46, 66),
        surface: rgb(41, 46, 66),
        surfaceHover: rgb(52, 59, 88),
        border: rgb(52, 59, 88),
        borderFocus: rgb(122, 162, 247),
        text: rgb(192, 202, 245),
        textSecondary: rgb(169, 177, 214),
        textDim: rgb(86, 95, 137),
        primary: rgb(122, 162, 247),
        primaryHover: rgb(125, 207, 255),
        primaryPressed: rgb(42, 195, 222),
        accent: rgb(187, 154, 247),
        error: rgb(247, 118, 142),
        warning: rgb(224, 175, 104),
        success: rgb(158, 206, 106),
        info: rgb(125, 207, 255)
      };
      bios = {
        bg: rgb(0, 0, 170),
        bgAlt: rgb(0, 0, 136),
        bgElevated: rgb(17, 17, 187),
        surface: rgb(0, 0, 136),
        surfaceHover: rgb(0, 0, 170),
        border: rgb(85, 85, 85),
        borderFocus: rgb(0, 170, 170),
        text: rgb(170, 170, 170),
        textSecondary: rgb(136, 136, 136),
        textDim: rgb(85, 85, 85),
        primary: rgb(0, 170, 170),
        primaryHover: rgb(85, 255, 255),
        primaryPressed: rgb(255, 255, 255),
        accent: rgb(255, 255, 85),
        error: rgb(255, 85, 85),
        warning: rgb(255, 170, 0),
        success: rgb(85, 255, 85),
        info: rgb(85, 255, 255)
      };
      win95 = {
        bg: rgb(192, 192, 192),
        bgAlt: rgb(160, 160, 160),
        bgElevated: rgb(223, 223, 223),
        surface: rgb(255, 255, 255),
        surfaceHover: rgb(232, 232, 232),
        border: rgb(128, 128, 128),
        borderFocus: rgb(0, 0, 128),
        text: rgb(0, 0, 0),
        textSecondary: rgb(64, 64, 64),
        textDim: rgb(128, 128, 128),
        primary: rgb(0, 0, 128),
        primaryHover: rgb(128, 0, 176),
        primaryPressed: rgb(160, 32, 240),
        accent: rgb(153, 0, 204),
        error: rgb(255, 0, 0),
        warning: rgb(255, 136, 0),
        success: rgb(0, 128, 0),
        info: rgb(0, 0, 255)
      };
      winamp = {
        bg: rgb(18, 18, 18),
        bgAlt: rgb(28, 28, 28),
        bgElevated: rgb(40, 40, 40),
        surface: rgb(32, 32, 32),
        surfaceHover: rgb(48, 48, 48),
        border: rgb(64, 64, 64),
        borderFocus: rgb(0, 255, 0),
        text: rgb(0, 255, 0),
        textSecondary: rgb(0, 204, 0),
        textDim: rgb(0, 128, 0),
        primary: rgb(0, 255, 0),
        primaryHover: rgb(102, 255, 102),
        primaryPressed: rgb(204, 255, 0),
        accent: rgb(255, 153, 0),
        error: rgb(255, 51, 51),
        warning: rgb(255, 204, 0),
        success: rgb(0, 255, 0),
        info: rgb(51, 204, 255)
      };
      glass = {
        bg: rgb(15, 20, 30),
        bgAlt: rgb(25, 32, 45),
        bgElevated: rgb(40, 50, 68),
        surface: rgb(35, 45, 60),
        surfaceHover: rgb(50, 62, 80),
        border: rgb(80, 110, 150),
        borderFocus: rgb(100, 180, 255),
        text: rgb(235, 240, 255),
        textSecondary: rgb(180, 195, 220),
        textDim: rgb(120, 140, 170),
        primary: rgb(100, 180, 255),
        primaryHover: rgb(140, 200, 255),
        primaryPressed: rgb(180, 220, 255),
        accent: rgb(160, 140, 255),
        error: rgb(255, 100, 120),
        warning: rgb(255, 200, 100),
        success: rgb(100, 230, 180),
        info: rgb(120, 200, 255)
      };
      themes = [
        { name: "Catppuccin Mocha", colors: catppuccin_mocha, styles: catppuccin_mocha_styles },
        { name: "Catppuccin Macchiato", colors: catppuccin_macchiato },
        { name: "Catppuccin Frappe", colors: catppuccin_frappe },
        { name: "Catppuccin Latte", colors: catppuccin_latte },
        { name: "Dracula", colors: dracula, styles: dracula_styles },
        { name: "Dracula Soft", colors: dracula_soft },
        { name: "Gruvbox Dark", colors: gruvbox_dark, styles: gruvbox_dark_styles },
        { name: "Gruvbox Light", colors: gruvbox_light },
        { name: "Nord", colors: nord, styles: nord_styles },
        { name: "Nord Light", colors: nord_light },
        { name: "One Dark", colors: one_dark },
        { name: "Rose Pine", colors: rose_pine },
        { name: "Rose Pine Dawn", colors: rose_pine_dawn },
        { name: "Solarized Dark", colors: solarized_dark, styles: solarized_dark_styles },
        { name: "Solarized Light", colors: solarized_light },
        { name: "Tokyo Night", colors: tokyo_night, styles: tokyo_night_styles },
        { name: "Tokyo Night Storm", colors: tokyo_night_storm },
        { name: "BIOS", colors: bios, styles: bios_styles },
        { name: "Win95 Vaporwave", colors: win95, styles: win95_styles },
        { name: "Winamp", colors: winamp, styles: winamp_styles },
        { name: "Glass", colors: glass, styles: glass_styles }
      ];
    }
  });

  // runtime/geometries/_baked.generated.ts
  var BAKED;
  var init_baked_generated = __esm({
    "runtime/geometries/_baked.generated.ts"() {
      BAKED = {};
    }
  });

  // runtime/geometries/intern.ts
  var intern_exports = {};
  __export(intern_exports, {
    bakeEntry: () => bakeEntry,
    hasShipped: () => hasShipped,
    internGeometry: () => internGeometry,
    internKey: () => internKey,
    isGeometryDef: () => isGeometryDef,
    markShipped: () => markShipped,
    resetShipped: () => resetShipped
  });
  function stable(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
    const keys = Object.keys(v).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
  }
  function internKey(def, params) {
    const resolved = { ...def.defaults ?? {}, ...params ?? {} };
    return def.id + "|" + stable(resolved);
  }
  function hasShipped(key) {
    return shipped.has(key);
  }
  function markShipped(key) {
    shipped.add(key);
  }
  function resetShipped() {
    shipped.clear();
  }
  function bakeEntry(def, params) {
    const key = internKey(def, params);
    const data = def.generate({ ...def.defaults ?? {}, ...params ?? {} });
    return { key, vertices: Array.from(data.positions), count: data.count, bounds: data.bounds.radius };
  }
  function internGeometry(def, params) {
    const key = internKey(def, params);
    let entry = cache.get(key);
    if (!entry) {
      entry = bakeEntry(def, params);
      cache.set(key, entry);
    }
    return entry;
  }
  function isGeometryDef(g) {
    return !!g && typeof g === "object" && typeof g.generate === "function" && typeof g.id === "string";
  }
  var cache, shipped;
  var init_intern = __esm({
    "runtime/geometries/intern.ts"() {
      init_baked_generated();
      cache = /* @__PURE__ */ new Map();
      for (const key of Object.keys(BAKED)) cache.set(key, BAKED[key]);
      shipped = /* @__PURE__ */ new Set();
    }
  });

  // runtime/audio/index.tsx
  var audio_exports = {};
  __export(audio_exports, {
    AUDIO_MODULE_TYPE: () => AUDIO_MODULE_TYPE,
    AUDIO_PARAM_DEFS: () => AUDIO_PARAM_DEFS,
    AUDIO_SOUND: () => AUDIO_SOUND,
    Audio: () => Audio,
    useAudio: () => useAudio
  });
  function encodeSoundSpec(sound) {
    const values = Array.isArray(sound) ? sound : [sound];
    return values.slice(0, 16).map((v) => Math.max(0, Math.floor(Number(v) || 0))).join(",");
  }
  function encodeSliceSpec(sliceStarts) {
    return sliceStarts.slice(0, 16).map((v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : 1;
    }).join(",");
  }
  function useAudio() {
    const ctx = React2.useContext(AudioContext);
    const resolve = (t) => typeof t === "number" ? t : ctx?.getId(t) ?? -1;
    return {
      getId: (n) => ctx?.getId(n),
      initAudio: () => hostInitAudio(),
      deinitAudio: () => {
        hostDeinitAudio();
      },
      isAudioInitialized: () => hostIsAudioInitialized(),
      play: () => {
        hostPlay();
      },
      pause: () => {
        hostPauseTransport();
      },
      stop: () => {
        hostStop();
      },
      setPlayhead: (measure) => {
        hostSetPlayhead(measure);
      },
      getPlayhead: () => hostGetPlayhead(),
      isPlaying: () => hostIsPlaying(),
      addModule: (id, type) => {
        hostAdd(id, AUDIO_MODULE_TYPE[type]);
        ctx?.types.set(id, type);
      },
      createAudioModule: (id, type) => {
        hostAdd(id, AUDIO_MODULE_TYPE[type]);
        ctx?.types.set(id, type);
      },
      removeModule: (id) => {
        hostRemove(id);
        ctx?.types.delete(id);
      },
      connectModules: (from, to, fromPort = 0, toPort = 0) => {
        hostConnect(from, fromPort, to, toPort);
      },
      disconnectModules: (from, to, fromPort = 0, toPort = 0) => {
        hostDisconnect(from, fromPort, to, toPort);
      },
      noteOn: (t, midi, velocity = 1) => {
        const id = resolve(t);
        if (id >= 0) hostNoteOn(id, midi, velocity);
      },
      noteOff: (t, midi) => {
        const id = resolve(t);
        if (id >= 0) hostNoteOff(id, midi);
      },
      loadSample: (t, slot, path, mode = "oneshot") => {
        const id = resolve(t);
        return id >= 0 ? hostLoadSample(id, slot, String(path), mode) > 0 : false;
      },
      clearSample: (t, slot) => {
        const id = resolve(t);
        return id >= 0 ? hostClearSample(id, slot) > 0 : false;
      },
      loadSound: (path) => hostLoadSound(String(path)),
      setParam: (t, name, v) => {
        const id = resolve(t);
        if (id < 0) return;
        const type = ctx?.getType(t);
        if (!type) return;
        const idx = AUDIO_PARAM_INDEX[type]?.[name];
        if (idx === void 0) return;
        hostSetParam(id, idx, v);
      },
      setModuleParam: (t, name, v) => {
        const id = resolve(t);
        if (id < 0) return;
        const type = ctx?.getType(t);
        if (!type) return;
        const idx = AUDIO_PARAM_INDEX[type]?.[name];
        if (idx === void 0) return;
        hostSetParam(id, idx, v);
      },
      setParamIndex: (t, idx, v) => {
        const id = resolve(t);
        if (id >= 0) hostSetParam(id, idx, v);
      },
      getModuleType: (t) => {
        const ctxType = ctx?.getType(t);
        if (ctxType) return ctxType;
        const id = resolve(t);
        if (id < 0) return void 0;
        return AUDIO_MODULE_TYPE_BY_ID[hostGetModuleType(id)];
      },
      getParamDefinitions: (t) => {
        const type = typeof t === "string" && t in AUDIO_PARAM_DEFS ? t : ctx?.getType(t) ?? AUDIO_MODULE_TYPE_BY_ID[hostGetModuleType(resolve(t))];
        return type ? AUDIO_PARAM_DEFS[type] ?? [] : [];
      },
      getParam: (t, param) => {
        const id = resolve(t);
        if (id < 0) return 0;
        if (typeof param === "number") return hostGetParam(id, param);
        const type = ctx?.getType(t) ?? AUDIO_MODULE_TYPE_BY_ID[hostGetModuleType(id)];
        const idx = type ? AUDIO_PARAM_INDEX[type]?.[param] : void 0;
        return idx === void 0 ? 0 : hostGetParam(id, idx);
      },
      setTempo: (startTempo, start, endTempo, end) => {
        hostSetTempo(startTempo, start, endTempo, end);
      },
      makeBeat: (sound, track, start, beat, stepsPerMeasure = 16) => {
        hostMakeBeat(encodeSoundSpec(sound), track, start, String(beat), stepsPerMeasure);
      },
      makePattern: (sound, track, start, pattern, stepsPerMeasure = 16) => {
        hostMakeBeat(encodeSoundSpec(sound), track, start, String(pattern), stepsPerMeasure);
      },
      makeBeatSlice: (sound, track, start, beat, sliceStarts, stepsPerMeasure = 16) => {
        hostMakeBeatSlice(encodeSoundSpec(sound), track, start, String(beat), encodeSliceSpec(sliceStarts), stepsPerMeasure);
      },
      makeSlicePattern: (sound, track, start, pattern, sliceStarts, stepsPerMeasure = 16) => {
        hostMakeBeatSlice(encodeSoundSpec(sound), track, start, String(pattern), encodeSliceSpec(sliceStarts), stepsPerMeasure);
      },
      setStepVelocity: (track, step, velocity) => {
        hostSetStepVelocity(track, step, velocity);
      },
      setStepProbability: (track, step, probability) => {
        hostSetStepProbability(track, step, probability);
      },
      setStepOffset: (track, step, offset) => {
        hostSetStepOffset(track, step, offset);
      },
      setStep: (sequencer, track, step, active, note = 36, velocity = 100) => {
        const id = resolve(sequencer);
        return id >= 0 ? hostSetStep(id, track, step, active, note, velocity) > 0 : false;
      },
      setTrackTarget: (sequencer, track, target) => {
        const id = resolve(sequencer);
        const targetId = resolve(target);
        return id >= 0 && targetId >= 0 ? hostSetTrackTarget(id, track, targetId) > 0 : false;
      },
      clearPattern: (sequencer) => {
        const id = resolve(sequencer);
        return id >= 0 ? hostClearPattern(id) > 0 : false;
      },
      clockPulse: (clock = 0) => {
        const id = resolve(clock);
        return id >= 0 ? hostClockPulse(id) > 0 : false;
      },
      clockStart: (clock = 0) => {
        const id = resolve(clock);
        return id >= 0 ? hostClockStart(id) > 0 : false;
      },
      clockStop: (clock = 0) => {
        const id = resolve(clock);
        return id >= 0 ? hostClockStop(id) > 0 : false;
      },
      insertMedia: (sound, track, start) => {
        hostInsertMedia(encodeSoundSpec(sound), track, start);
      },
      fitMedia: (sound, track, start, end) => {
        hostFitMedia(encodeSoundSpec(sound), track, start, end);
      },
      insertMediaSection: (sound, track, start, sliceStart, sliceEnd) => {
        hostInsertMediaSection(encodeSoundSpec(sound), track, start, sliceStart, sliceEnd);
      },
      clearTrack: (track, start, end) => {
        hostClearTrack(track, start, end);
      },
      setTrackVolume: (track, volume) => {
        hostSetTrackVolume(track, volume);
      },
      setTrackPan: (track, pan) => {
        hostSetTrackPan(track, pan);
      },
      setTrackMute: (track, muted) => {
        hostSetTrackMute(track, muted);
      },
      setTrackSolo: (track, soloed) => {
        hostSetTrackSolo(track, soloed);
      },
      dur: (sound) => hostDur(encodeSoundSpec(sound)),
      createAudioStretch: (sound, stretchFactor) => hostCreateAudioStretch(encodeSoundSpec(sound), stretchFactor),
      stretchSound: (sound, factor) => hostCreateAudioStretch(encodeSoundSpec(sound), factor),
      createAudioSlice: (sound, sliceStart, sliceEnd) => hostCreateAudioSlice(encodeSoundSpec(sound), sliceStart, sliceEnd),
      sliceSound: (sound, start, end) => hostCreateAudioSlice(encodeSoundSpec(sound), start, end),
      setMasterVolume: (volume) => {
        hostMasterGain(volume);
      },
      setMasterEffect: (_effectType, _params) => {
      },
      getModuleCount: () => hostGetModuleCount(),
      getConnectionCount: () => hostGetConnectionCount(),
      getPeakLevel: () => hostGetPeakLevel(),
      getCallbackTime: () => hostGetCallbackTime()
    };
  }
  function AudioRoot({ gain, children }) {
    React2.useEffect(() => {
      if (typeof gain === "number") hostMasterGain(gain);
    }, [gain]);
    return React2.createElement(AudioContext.Provider, { value: SHARED_AUDIO_CTX }, children);
  }
  function AudioModule(props) {
    const { id: name, type, children: _, ...paramProps } = props;
    const ctx = React2.useContext(AudioContext);
    const numIdRef = React2.useRef(-1);
    if (numIdRef.current === -1 && ctx) {
      numIdRef.current = ctx.nextId.current++;
      if (name) {
        ctx.names.set(name, numIdRef.current);
        ctx.types.set(numIdRef.current, type);
      }
    }
    const numId = numIdRef.current;
    React2.useEffect(() => {
      if (numId < 0) return;
      hostAdd(numId, AUDIO_MODULE_TYPE[type]);
      return () => {
        hostRemove(numId);
        if (name && ctx) {
          ctx.names.delete(name);
          ctx.types.delete(numId);
        }
      };
    }, []);
    const lastParamsRef = React2.useRef({});
    React2.useEffect(() => {
      if (numId < 0) return;
      const schema = AUDIO_PARAM_INDEX[type];
      if (!schema) return;
      const last = lastParamsRef.current;
      for (const key of Object.keys(paramProps)) {
        const idx = schema[key];
        if (idx === void 0) continue;
        const v = paramProps[key];
        if (typeof v !== "number") continue;
        if (last[key] === v) continue;
        last[key] = v;
        hostSetParam(numId, idx, v);
      }
    });
    return null;
  }
  function AudioConnection({ from, to, fromPort = 0, toPort = 0 }) {
    const ctx = React2.useContext(AudioContext);
    const resolve = (t) => typeof t === "number" ? t : ctx?.getId(t) ?? -1;
    React2.useEffect(() => {
      let connected = false;
      let aId = -1, bId = -1, aPort = fromPort, bPort = toPort;
      const t = setTimeout(() => {
        aId = resolve(from);
        bId = resolve(to);
        if (aId < 0 || bId < 0) return;
        hostConnect(aId, aPort, bId, bPort);
        connected = true;
      }, 0);
      return () => {
        clearTimeout(t);
        if (connected) hostDisconnect(aId, aPort, bId, bPort);
      };
    }, [from, to, fromPort, toPort]);
    return null;
  }
  var React2, AUDIO_MODULE_TYPE, AUDIO_SOUND, AUDIO_PARAM_DEFS, AUDIO_PARAM_INDEX, AUDIO_MODULE_TYPE_BY_ID, host, hostAdd, hostRemove, hostConnect, hostDisconnect, hostSetParam, hostNoteOn, hostNoteOff, hostMasterGain, hostInitAudio, hostDeinitAudio, hostIsAudioInitialized, hostPlay, hostPauseTransport, hostStop, hostSetPlayhead, hostGetPlayhead, hostIsPlaying, hostSetTempo, hostMakeBeat, hostMakeBeatSlice, hostSetStepVelocity, hostSetStepProbability, hostSetStepOffset, hostSetStep, hostSetTrackTarget, hostClearPattern, hostClockPulse, hostClockStart, hostClockStop, hostInsertMedia, hostFitMedia, hostInsertMediaSection, hostClearTrack, hostSetTrackVolume, hostSetTrackPan, hostSetTrackMute, hostSetTrackSolo, hostDur, hostCreateAudioStretch, hostCreateAudioSlice, hostLoadSound, hostLoadSample, hostClearSample, hostGetModuleCount, hostGetConnectionCount, hostGetPeakLevel, hostGetCallbackTime, hostGetModuleType, hostGetParam, SHARED_AUDIO_NAMES, SHARED_AUDIO_TYPES, SHARED_AUDIO_NEXT_ID, SHARED_AUDIO_CTX, AudioContext, AudioBase, Audio;
  var init_audio = __esm({
    "runtime/audio/index.tsx"() {
      React2 = require_react();
      AUDIO_MODULE_TYPE = {
        oscillator: 0,
        filter: 1,
        amplifier: 2,
        mixer: 3,
        delay: 4,
        envelope: 5,
        lfo: 6,
        sequencer: 7,
        sampler: 8,
        custom: 9,
        instrument: 10,
        clock: 11
      };
      AUDIO_SOUND = {
        kick: 0,
        snare: 1,
        hat: 2,
        bass: 3,
        lead: 4
      };
      AUDIO_PARAM_DEFS = {
        oscillator: [
          { name: "waveform", index: 0, min: 0, max: 4, defaultValue: 0 },
          { name: "frequency", index: 1, min: 20, max: 2e4, defaultValue: 440 },
          { name: "detune", index: 2, min: -1200, max: 1200, defaultValue: 0 },
          { name: "gain", index: 3, min: 0, max: 1, defaultValue: 0.5 },
          { name: "fm_amount", index: 4, min: 0, max: 1, defaultValue: 0 }
        ],
        filter: [
          { name: "cutoff", index: 0, min: 20, max: 2e4, defaultValue: 1200 },
          { name: "resonance", index: 1, min: 0, max: 1, defaultValue: 0.1 },
          { name: "mode", index: 2, min: 0, max: 2, defaultValue: 0 }
        ],
        amplifier: [
          { name: "gain", index: 0, min: 0, max: 1, defaultValue: 0.5 }
        ],
        mixer: [
          { name: "gain_1", index: 0, min: 0, max: 1, defaultValue: 1 },
          { name: "gain_2", index: 1, min: 0, max: 1, defaultValue: 1 },
          { name: "gain_3", index: 2, min: 0, max: 1, defaultValue: 1 },
          { name: "gain_4", index: 3, min: 0, max: 1, defaultValue: 1 }
        ],
        delay: [
          { name: "time", index: 0, min: 0, max: 2, defaultValue: 0.25 },
          { name: "feedback", index: 1, min: 0, max: 0.95, defaultValue: 0.3 },
          { name: "mix", index: 2, min: 0, max: 1, defaultValue: 0.25 }
        ],
        envelope: [
          { name: "attack", index: 0, min: 0, max: 5, defaultValue: 0.01 },
          { name: "decay", index: 1, min: 0, max: 5, defaultValue: 0.2 },
          { name: "sustain", index: 2, min: 0, max: 1, defaultValue: 0.8 },
          { name: "release", index: 3, min: 0, max: 5, defaultValue: 0.3 }
        ],
        lfo: [
          { name: "rate", index: 0, min: 0.01, max: 20, defaultValue: 1 },
          { name: "depth", index: 1, min: 0, max: 1, defaultValue: 0.5 },
          { name: "waveform", index: 2, min: 0, max: 4, defaultValue: 0 }
        ],
        clock: [
          { name: "bpm", index: 0, min: 20, max: 300, defaultValue: 120 },
          { name: "division", index: 1, min: 0, max: 5, defaultValue: 1 },
          { name: "swing", index: 2, min: 0, max: 1, defaultValue: 0 },
          { name: "running", index: 3, min: 0, max: 1, defaultValue: 0 }
        ],
        sequencer: [
          { name: "steps", index: 0, min: 1, max: 64, defaultValue: 16 },
          { name: "tracks", index: 1, min: 1, max: 8, defaultValue: 4 },
          { name: "bpm", index: 2, min: 20, max: 300, defaultValue: 120 },
          { name: "running", index: 3, min: 0, max: 1, defaultValue: 1 }
        ],
        sampler: [
          { name: "gain", index: 0, min: 0, max: 1, defaultValue: 1 },
          { name: "loop", index: 1, min: 0, max: 1, defaultValue: 0 },
          { name: "slot", index: 2, min: 1, max: 16, defaultValue: 1 }
        ],
        custom: [],
        instrument: [
          { name: "voice", index: 0, min: 0, max: 4, defaultValue: 0 },
          { name: "tone", index: 1, min: 0, max: 1, defaultValue: 0.5 },
          { name: "decay", index: 2, min: 0.05, max: 1, defaultValue: 0.35 },
          { name: "color", index: 3, min: 0, max: 1, defaultValue: 0.5 },
          { name: "drive", index: 4, min: 0, max: 1, defaultValue: 0.25 },
          { name: "gain", index: 5, min: 0, max: 1.5, defaultValue: 0.8 }
        ]
      };
      AUDIO_PARAM_INDEX = Object.fromEntries(
        Object.keys(AUDIO_PARAM_DEFS).map((type) => [
          type,
          Object.fromEntries(AUDIO_PARAM_DEFS[type].map((def) => [def.name, def.index]))
        ])
      );
      AUDIO_MODULE_TYPE_BY_ID = Object.fromEntries(
        Object.keys(AUDIO_MODULE_TYPE).map((type) => [AUDIO_MODULE_TYPE[type], type])
      );
      host = () => globalThis;
      hostAdd = (id, mt) => host().__audioAddModule?.(id, mt);
      hostRemove = (id) => host().__audioRemoveModule?.(id);
      hostConnect = (a, ap, b, bp) => host().__audioConnect?.(a, ap, b, bp);
      hostDisconnect = (a, ap, b, bp) => host().__audioDisconnect?.(a, ap, b, bp);
      hostSetParam = (id, p, v) => host().__audioSetParam?.(id, p, v);
      hostNoteOn = (id, midi, velocity = 1) => host().__audioNoteOn?.(id, midi, velocity);
      hostNoteOff = (id, midi) => host().__audioNoteOff?.(id, midi);
      hostMasterGain = (g) => host().__audioMasterGain?.(g);
      hostInitAudio = () => {
        const h2 = host();
        const init = h2.__audioInit ?? h2.__audio_init;
        const isInitialized = h2.__audioIsInitialized ?? h2.__audio_is_initialized;
        const resume = h2.__audioResume ?? h2.__audio_resume;
        const ok = typeof init === "function" ? Number(init() ?? 0) > 0 : Number(isInitialized?.() ?? 0) > 0;
        if (ok && typeof resume === "function") resume();
        return ok;
      };
      hostDeinitAudio = () => {
        const h2 = host();
        const fn = h2.__audioDeinit ?? h2.__audio_deinit;
        return typeof fn === "function" ? fn() : 0;
      };
      hostIsAudioInitialized = () => Boolean(Number((host().__audioIsInitialized ?? host().__audio_is_initialized)?.() ?? 0));
      hostPlay = () => {
        const fn = host().__audioPlay ?? host().__audio_play;
        return typeof fn === "function" ? fn() : 0;
      };
      hostPauseTransport = () => {
        const fn = host().__audioPause ?? host().__audio_transport_pause;
        return typeof fn === "function" ? fn() : 0;
      };
      hostStop = () => {
        const fn = host().__audioStop ?? host().__audio_stop;
        return typeof fn === "function" ? fn() : 0;
      };
      hostSetPlayhead = (measure) => {
        const fn = host().__audioSetPlayhead ?? host().__audio_set_playhead;
        return typeof fn === "function" ? fn(measure) : 0;
      };
      hostGetPlayhead = () => Number((host().__audioGetPlayhead ?? host().__audio_get_playhead)?.() ?? 1);
      hostIsPlaying = () => Boolean(Number((host().__audioIsPlaying ?? host().__audio_is_playing)?.() ?? 0));
      hostSetTempo = (startTempo, start, endTempo, end) => {
        const fn = host().__audioSetTempo ?? host().__audio_set_tempo;
        if (typeof fn !== "function") return 0;
        if (typeof endTempo === "number" && typeof end === "number") return fn(startTempo, start, endTempo, end);
        return fn(startTempo, start);
      };
      hostMakeBeat = (soundSpec, track, start, beat, stepsPerMeasure) => {
        const fn = host().__audioMakeBeat ?? host().__audio_make_beat;
        return typeof fn === "function" ? fn(soundSpec, track, start, beat, stepsPerMeasure) : 0;
      };
      hostMakeBeatSlice = (soundSpec, track, start, beat, sliceSpec, stepsPerMeasure) => {
        const fn = host().__audioMakeBeatSlice ?? host().__audio_make_beat_slice;
        return typeof fn === "function" ? fn(soundSpec, track, start, beat, sliceSpec, stepsPerMeasure) : 0;
      };
      hostSetStepVelocity = (track, step, velocity) => {
        const fn = host().__audioSetStepVelocity ?? host().__audio_set_step_velocity;
        return typeof fn === "function" ? fn(track, step, velocity) : 0;
      };
      hostSetStepProbability = (track, step, probability) => {
        const fn = host().__audioSetStepProbability ?? host().__audio_set_step_probability;
        return typeof fn === "function" ? fn(track, step, probability) : 0;
      };
      hostSetStepOffset = (track, step, offset) => {
        const fn = host().__audioSetStepOffset ?? host().__audio_set_step_offset;
        return typeof fn === "function" ? fn(track, step, offset) : 0;
      };
      hostSetStep = (id, track, step, active, note = 36, velocity = 100) => {
        const fn = host().__audioSetStep ?? host().__audio_set_step;
        return typeof fn === "function" ? fn(id, track, step, active ? 1 : 0, note, velocity) : 0;
      };
      hostSetTrackTarget = (id, track, target) => {
        const fn = host().__audioSetTrackTarget ?? host().__audio_set_track_target;
        return typeof fn === "function" ? fn(id, track, target) : 0;
      };
      hostClearPattern = (id) => {
        const fn = host().__audioClearPattern ?? host().__audio_clear_pattern;
        return typeof fn === "function" ? fn(id) : 0;
      };
      hostClockPulse = (id = 0) => {
        const fn = host().__audioClockPulse ?? host().__audio_clock_pulse;
        return typeof fn === "function" ? fn(id) : 0;
      };
      hostClockStart = (id = 0) => {
        const fn = host().__audioClockStart ?? host().__audio_clock_start;
        return typeof fn === "function" ? fn(id) : 0;
      };
      hostClockStop = (id = 0) => {
        const fn = host().__audioClockStop ?? host().__audio_clock_stop;
        return typeof fn === "function" ? fn(id) : 0;
      };
      hostInsertMedia = (soundSpec, track, start) => {
        const fn = host().__audioInsertMedia ?? host().__audio_insert_media;
        return typeof fn === "function" ? fn(soundSpec, track, start) : 0;
      };
      hostFitMedia = (soundSpec, track, start, end) => {
        const fn = host().__audioFitMedia ?? host().__audio_fit_media;
        return typeof fn === "function" ? fn(soundSpec, track, start, end) : 0;
      };
      hostInsertMediaSection = (soundSpec, track, start, sliceStart, sliceEnd) => {
        const fn = host().__audioInsertMediaSection ?? host().__audio_insert_media_section;
        return typeof fn === "function" ? fn(soundSpec, track, start, sliceStart, sliceEnd) : 0;
      };
      hostClearTrack = (track, start, end) => {
        const fn = host().__audioClearTrack ?? host().__audio_clear_track;
        if (typeof fn !== "function") return 0;
        if (typeof start === "number" && typeof end === "number") return fn(track, start, end);
        return fn(track);
      };
      hostSetTrackVolume = (track, volume) => {
        const fn = host().__audioSetTrackVolume ?? host().__audio_set_track_volume;
        return typeof fn === "function" ? fn(track, volume) : 0;
      };
      hostSetTrackPan = (track, pan) => {
        const fn = host().__audioSetTrackPan ?? host().__audio_set_track_pan;
        return typeof fn === "function" ? fn(track, pan) : 0;
      };
      hostSetTrackMute = (track, muted) => {
        const fn = host().__audioSetTrackMute ?? host().__audio_set_track_mute;
        return typeof fn === "function" ? fn(track, muted ? 1 : 0) : 0;
      };
      hostSetTrackSolo = (track, soloed) => {
        const fn = host().__audioSetTrackSolo ?? host().__audio_set_track_solo;
        return typeof fn === "function" ? fn(track, soloed ? 1 : 0) : 0;
      };
      hostDur = (soundSpec) => {
        const fn = host().__audioDur ?? host().__audio_dur;
        return typeof fn === "function" ? Number(fn(soundSpec) ?? 0) : 0;
      };
      hostCreateAudioStretch = (soundSpec, stretchFactor) => {
        const fn = host().__audioCreateAudioStretch ?? host().__audio_create_audio_stretch;
        return typeof fn === "function" ? Number(fn(soundSpec, stretchFactor) ?? 0) : 0;
      };
      hostCreateAudioSlice = (soundSpec, sliceStart, sliceEnd) => {
        const fn = host().__audioCreateAudioSlice ?? host().__audio_create_audio_slice;
        return typeof fn === "function" ? Number(fn(soundSpec, sliceStart, sliceEnd) ?? 0) : 0;
      };
      hostLoadSound = (path) => {
        const fn = host().__audioLoadSound ?? host().__audio_load_sound;
        return typeof fn === "function" ? Number(fn(path) ?? 0) : 0;
      };
      hostLoadSample = (id, slot, path, mode = "oneshot") => {
        const fn = host().__audioLoadSample ?? host().__audio_load_sample;
        return typeof fn === "function" ? Number(fn(id, slot, path, mode) ?? 0) : 0;
      };
      hostClearSample = (id, slot) => {
        const fn = host().__audioClearSample ?? host().__audio_clear_sample;
        return typeof fn === "function" ? Number(fn(id, slot) ?? 0) : 0;
      };
      hostGetModuleCount = () => Number((host().__audioGetModuleCount ?? host().__audio_get_module_count)?.() ?? 0);
      hostGetConnectionCount = () => Number((host().__audioGetConnectionCount ?? host().__audio_get_connection_count)?.() ?? 0);
      hostGetPeakLevel = () => Number((host().__audioGetPeakLevel ?? host().__audio_get_peak_level)?.() ?? 0);
      hostGetCallbackTime = () => Number((host().__audioGetCallbackTime ?? host().__audio_get_callback_us)?.() ?? 0);
      hostGetModuleType = (id) => Number((host().__audioGetModuleType ?? host().__audio_get_module_type)?.(id) ?? -1);
      hostGetParam = (id, index) => Number((host().__audioGetParam ?? host().__audio_get_param)?.(id, index) ?? 0);
      SHARED_AUDIO_NAMES = /* @__PURE__ */ new Map();
      SHARED_AUDIO_TYPES = /* @__PURE__ */ new Map();
      SHARED_AUDIO_NEXT_ID = { current: 1 };
      SHARED_AUDIO_CTX = {
        names: SHARED_AUDIO_NAMES,
        types: SHARED_AUDIO_TYPES,
        nextId: SHARED_AUDIO_NEXT_ID,
        getId: (name) => SHARED_AUDIO_NAMES.get(name),
        getType: (idOrName) => {
          const id = typeof idOrName === "number" ? idOrName : SHARED_AUDIO_NAMES.get(idOrName);
          return id !== void 0 ? SHARED_AUDIO_TYPES.get(id) : void 0;
        }
      };
      AudioContext = React2.createContext(SHARED_AUDIO_CTX);
      AudioBase = AudioRoot;
      AudioBase.Module = AudioModule;
      AudioBase.Connection = AudioConnection;
      Audio = AudioBase;
    }
  });

  // runtime/hooks/useLatest.ts
  function useLatest(value) {
    const ref = (0, import_react.useRef)(value);
    ref.current = value;
    return ref;
  }
  var import_react;
  var init_useLatest = __esm({
    "runtime/hooks/useLatest.ts"() {
      import_react = __toESM(require_react(), 1);
    }
  });

  // runtime/hooks/useInterval.ts
  function useInterval(fn, ms) {
    const latest = useLatest(fn);
    (0, import_react2.useEffect)(() => {
      if (ms == null || ms <= 0) return;
      const id = setInterval(() => latest.current(), ms);
      return () => clearInterval(id);
    }, [ms]);
  }
  var import_react2;
  var init_useInterval = __esm({
    "runtime/hooks/useInterval.ts"() {
      import_react2 = __toESM(require_react(), 1);
      init_useLatest();
    }
  });

  // runtime/audio/controls.tsx
  var controls_exports = {};
  __export(controls_exports, {
    AUDIO_SOUND: () => AUDIO_SOUND,
    AudioControls: () => AudioControls,
    Keybed: () => Keybed,
    Knob: () => Knob,
    LevelMeter: () => LevelMeter,
    ModulePanel: () => ModulePanel,
    Pads: () => Pads,
    PatternTrack: () => PatternTrack,
    Scope: () => Scope,
    Slider: () => Slider,
    StepGrid: () => StepGrid,
    StepMeter: () => StepMeter,
    StepPattern: () => StepPattern,
    TrackSelector: () => TrackSelector,
    Transport: () => Transport,
    XYPad: () => XYPad
  });
  function controlEvent() {
    return {
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      }
    };
  }
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
  function quantize(value, step) {
    if (!Number.isFinite(step) || step <= 0) return value;
    return Math.round(value / step) * step;
  }
  function noteName(note) {
    const idx = (note % 12 + 12) % 12;
    return `${NOTE_NAMES[idx]}${Math.floor(note / 12) - 1}`;
  }
  function isBlackKey(note) {
    return [1, 3, 6, 8, 10].includes((note % 12 + 12) % 12);
  }
  function normalizeHostPattern(pattern, sounds) {
    const multi = Array.isArray(sounds) && sounds.length > 1;
    return pattern.split("").map((char) => {
      if (char === "-" || char === "+") return char;
      if (char === "X" || char === "x") return multi ? "0" : "0";
      if (STEP_TOKENS.includes(char.toUpperCase())) return char.toUpperCase();
      return "-";
    }).join("");
  }
  function cyclePatternLevel(level, levels) {
    const max = Math.max(2, Math.min(3, Math.floor(levels || 3)));
    const next = Math.max(0, Math.min(max - 1, Math.floor(Number(level) || 0))) + 1;
    return next >= max ? 0 : next;
  }
  function patternStringFromSteps(steps) {
    return steps.map((level) => Number(level) > 0 ? "0" : "-").join("");
  }
  function valueFromPointer(event, rect, min, max, orientation) {
    if (!rect || typeof event?.x !== "number" || typeof event?.y !== "number") return null;
    const horizontal = orientation === "horizontal";
    const size = Math.max(1, horizontal ? rect.width : rect.height);
    const offset = horizontal ? event.x - rect.x : rect.y + rect.height - event.y;
    return min + clamp(offset / size, 0, 1) * (max - min);
  }
  function SmallButton({ label, onPress, active }) {
    return /* @__PURE__ */ React3.createElement(
      Pressable,
      {
        onPress,
        style: {
          minWidth: 34,
          paddingTop: 7,
          paddingBottom: 7,
          paddingLeft: 10,
          paddingRight: 10,
          borderRadius: 7,
          backgroundColor: active ? "#f2b03b" : "#1f2933",
          borderWidth: 1,
          borderColor: active ? "#fde68a" : "#374151",
          alignItems: "center"
        }
      },
      /* @__PURE__ */ React3.createElement(Text, { fontSize: 9, color: active ? "#121212" : "#edf2f7" }, label)
    );
  }
  function Keybed({
    target,
    range = [36, 72],
    layout = "piano",
    velocity = true,
    sustain = false,
    onNoteOn,
    onNoteOff
  }) {
    const audio = useAudio();
    const latchedRef = React3.useRef(/* @__PURE__ */ new Set());
    const activeRef = React3.useRef(/* @__PURE__ */ new Set());
    const low = Math.floor(range[0] ?? 36);
    const high = Math.max(low + 1, Math.floor(range[1] ?? 72));
    const notes = Array.from({ length: high - low }, (_, i) => low + i);
    React3.useEffect(() => {
      if (sustain) return;
      for (const note of latchedRef.current) audio.noteOff(target, note);
      latchedRef.current.clear();
    }, [sustain, target]);
    React3.useEffect(() => () => {
      for (const note of latchedRef.current) audio.noteOff(target, note);
      latchedRef.current.clear();
    }, [target]);
    const noteDown = (note, payload) => {
      const ev = controlEvent();
      if (sustain && latchedRef.current.has(note)) {
        onNoteOff?.(note, ev);
        if (!ev.defaultPrevented) audio.noteOff(target, note);
        latchedRef.current.delete(note);
        return;
      }
      if (!sustain && activeRef.current.has(note)) return;
      const v = velocity ? clamp(Number(payload?.pressure ?? 1) || 1, 0, 1) : 1;
      onNoteOn?.(note, v, ev);
      if (!ev.defaultPrevented) audio.noteOn(target, note, v);
      if (sustain) latchedRef.current.add(note);
      else activeRef.current.add(note);
    };
    const noteUp = (note) => {
      if (sustain || !activeRef.current.has(note)) return;
      const ev = controlEvent();
      onNoteOff?.(note, ev);
      if (!ev.defaultPrevented) audio.noteOff(target, note);
      activeRef.current.delete(note);
    };
    const keyStyle = (note) => {
      const black = isBlackKey(note);
      if (layout === "grid") {
        return {
          width: 44,
          height: 38,
          borderRadius: 6,
          backgroundColor: black ? "#27313d" : "#edf2f7",
          borderWidth: 1,
          borderColor: black ? "#111827" : "#cbd5e1",
          alignItems: "center",
          justifyContent: "center"
        };
      }
      return {
        width: black ? 24 : 30,
        height: black ? 74 : 108,
        borderRadius: 5,
        backgroundColor: black ? "#111827" : "#f8fafc",
        borderWidth: 1,
        borderColor: black ? "#020617" : "#cbd5e1",
        alignItems: "center",
        justifyContent: "flexEnd",
        paddingBottom: 7,
        marginTop: black ? 0 : 10
      };
    };
    return /* @__PURE__ */ React3.createElement(Box, { style: { flexDirection: "row", flexWrap: layout === "grid" ? "wrap" : "nowrap", gap: layout === "grid" ? 6 : 2, alignItems: "flexStart" } }, notes.map((note) => /* @__PURE__ */ React3.createElement(
      Pressable,
      {
        key: note,
        onMouseDown: (payload) => noteDown(note, payload),
        onMouseUp: () => noteUp(note),
        onMouseLeave: () => noteUp(note),
        style: keyStyle(note)
      },
      /* @__PURE__ */ React3.createElement(Text, { fontSize: 7, color: isBlackKey(note) ? "#f8fafc" : "#111827" }, noteName(note))
    )));
  }
  function Pads({
    target,
    sounds,
    rows = 2,
    cols = 4,
    velocity = true,
    mode = "trigger",
    onTrigger
  }) {
    const audio = useAudio();
    const [latched, setLatched] = React3.useState({});
    const activeRef = React3.useRef({});
    const latchedRef = React3.useRef({});
    const total = Math.max(1, rows * cols);
    React3.useEffect(() => {
      latchedRef.current = latched;
    }, [latched]);
    React3.useEffect(() => () => {
      if (typeof target !== "string") return;
      for (let i = 0; i < total; i++) {
        if (latchedRef.current[i]) audio.noteOff(target, 36 + i);
      }
    }, [target, total]);
    const padDown = (index, payload) => {
      const sound = sounds[index];
      if (typeof sound !== "number") return;
      const v = velocity ? clamp(Number(payload?.pressure ?? 1) || 1, 0, 1) : 1;
      const ev = controlEvent();
      onTrigger?.(sound, v, ev);
      if (ev.defaultPrevented) return;
      if (typeof target === "number") {
        audio.insertMedia(sound, target, audio.getPlayhead());
        return;
      }
      const note = 36 + index;
      if (mode === "toggle") {
        if (latched[index]) {
          audio.noteOff(target, note);
          setLatched((prev) => ({ ...prev, [index]: false }));
        } else {
          audio.noteOn(target, note, v);
          setLatched((prev) => ({ ...prev, [index]: true }));
        }
        return;
      }
      if (activeRef.current[index]) return;
      activeRef.current[index] = true;
      audio.noteOn(target, note, v);
    };
    const padUp = (index) => {
      if (typeof target !== "string" || mode === "toggle") return;
      if (!activeRef.current[index]) return;
      activeRef.current[index] = false;
      audio.noteOff(target, 36 + index);
    };
    return /* @__PURE__ */ React3.createElement(Box, { style: { flexDirection: "row", flexWrap: "wrap", gap: 8 } }, Array.from({ length: total }, (_, index) => {
      const disabled = typeof sounds[index] !== "number";
      const active = !!latched[index];
      return /* @__PURE__ */ React3.createElement(
        Pressable,
        {
          key: index,
          onMouseDown: (payload) => padDown(index, payload),
          onMouseUp: () => padUp(index),
          onMouseLeave: () => padUp(index),
          style: {
            width: 64,
            height: 56,
            borderRadius: 8,
            backgroundColor: disabled ? "#30343b" : active ? "#f2b03b" : "#334155",
            borderWidth: 1,
            borderColor: disabled ? "#414852" : active ? "#fde68a" : "#64748b",
            justifyContent: "center",
            alignItems: "center"
          }
        },
        /* @__PURE__ */ React3.createElement(Text, { fontSize: 9, color: disabled ? "#737b86" : active ? "#111827" : "#f8fafc" }, disabled ? "-" : `pad ${index + 1}`)
      );
    }));
  }
  function Slider({
    target,
    param,
    property = "param",
    min = 0,
    max = 1,
    defaultValue,
    step = 0.01,
    orientation = "vertical",
    onChange
  }) {
    const audio = useAudio();
    const [trackRect, setTrackRect] = React3.useState(null);
    const draggingRef = React3.useRef(false);
    const initial = React3.useMemo(() => {
      if (typeof defaultValue === "number") return defaultValue;
      if (property === "param" && param && target !== "master") return audio.getParam(target, param);
      return property === "pan" ? 0 : min;
    }, []);
    const [value, setValue] = React3.useState(clamp(initial, min, max));
    const emit = (next) => {
      const v = clamp(quantize(next, step), min, max);
      setValue(v);
      onChange?.(v);
      if (property === "volume" && target === "master") audio.setMasterVolume(v);
      else if (property === "volume" && typeof target === "number") audio.setTrackVolume(target, v);
      else if (property === "pan" && typeof target === "number") audio.setTrackPan(target, v);
      else if (property === "param" && param && target !== "master") audio.setModuleParam(target, param, v);
    };
    const emitPointer = (payload) => {
      const next = valueFromPointer(payload, trackRect, min, max, orientation);
      if (next != null) emit(next);
    };
    const pct = max === min ? 0 : (value - min) / (max - min);
    const horizontal = orientation === "horizontal";
    return /* @__PURE__ */ React3.createElement(Box, { style: { gap: 6, alignItems: "center", minWidth: horizontal ? 150 : 54 } }, /* @__PURE__ */ React3.createElement(Text, { fontSize: 8, color: "#cbd5e1" }, param ?? property), /* @__PURE__ */ React3.createElement(
      Box,
      {
        style: {
          width: horizontal ? 132 : 44,
          height: horizontal ? 26 : orientation === "rotary" ? 54 : 132,
          borderRadius: orientation === "rotary" ? 27 : 7,
          backgroundColor: "#111827",
          borderWidth: 1,
          borderColor: "#334155",
          justifyContent: "center",
          alignItems: "center",
          padding: 5
        },
        onLayout: setTrackRect,
        onMouseDown: (payload) => {
          draggingRef.current = true;
          emitPointer(payload);
        },
        onMouseMove: (payload) => {
          if (draggingRef.current) emitPointer(payload);
        },
        onMouseUp: () => {
          draggingRef.current = false;
        },
        onMouseLeave: () => {
          draggingRef.current = false;
        }
      },
      /* @__PURE__ */ React3.createElement(Box, { style: {
        width: horizontal ? Math.max(6, pct * 118) : orientation === "rotary" ? 8 : 22,
        height: horizontal ? 12 : orientation === "rotary" ? Math.max(8, pct * 32) : Math.max(8, pct * 116),
        borderRadius: 5,
        backgroundColor: "#f2b03b"
      } })
    ), /* @__PURE__ */ React3.createElement(Text, { fontSize: 8, color: "#e5e7eb" }, value.toFixed(2)), /* @__PURE__ */ React3.createElement(Box, { style: { flexDirection: "row", gap: 5 } }, /* @__PURE__ */ React3.createElement(SmallButton, { label: "-", onPress: () => emit(value - step) }), /* @__PURE__ */ React3.createElement(SmallButton, { label: "+", onPress: () => emit(value + step) })));
  }
  function XYPad({
    target,
    xParam,
    yParam,
    xRange = [0, 1],
    yRange = [0, 1],
    defaultValue,
    onChange
  }) {
    const audio = useAudio();
    const [point, setPoint] = React3.useState(defaultValue ?? { x: xRange[0], y: yRange[0] });
    const [padRect, setPadRect] = React3.useState(null);
    const draggingRef = React3.useRef(false);
    const xs = [0, 0.25, 0.5, 0.75, 1];
    const ys = [1, 0.75, 0.5, 0.25, 0];
    const setAxis = (xp, yp) => {
      const x = xRange[0] + (xRange[1] - xRange[0]) * xp;
      const y = yRange[0] + (yRange[1] - yRange[0]) * yp;
      setPoint({ x, y });
      onChange?.(x, y);
      audio.setModuleParam(target, xParam, x);
      if (yParam) audio.setModuleParam(target, yParam, y);
    };
    const setFromPointer = (payload) => {
      if (!padRect || typeof payload?.x !== "number" || typeof payload?.y !== "number") return;
      const xp = clamp((payload.x - padRect.x) / Math.max(1, padRect.width), 0, 1);
      const yp = clamp(1 - (payload.y - padRect.y) / Math.max(1, padRect.height), 0, 1);
      setAxis(xp, yp);
    };
    return /* @__PURE__ */ React3.createElement(Box, { style: { gap: 6 } }, /* @__PURE__ */ React3.createElement(
      Box,
      {
        onLayout: setPadRect,
        onMouseDown: (payload) => {
          draggingRef.current = true;
          setFromPointer(payload);
        },
        onMouseMove: (payload) => {
          if (draggingRef.current) setFromPointer(payload);
        },
        onMouseUp: () => {
          draggingRef.current = false;
        },
        onMouseLeave: () => {
          draggingRef.current = false;
        },
        style: { width: 178, flexDirection: "row", flexWrap: "wrap", gap: 4, backgroundColor: "#111827", borderRadius: 8, padding: 8, borderWidth: 1, borderColor: "#334155" }
      },
      ys.map((yp) => xs.map((xp) => {
        const active = Math.abs(point.x - (xRange[0] + (xRange[1] - xRange[0]) * xp)) < 1e-3 && Math.abs(point.y - (yRange[0] + (yRange[1] - yRange[0]) * yp)) < 1e-3;
        return /* @__PURE__ */ React3.createElement(Pressable, { key: `${xp}:${yp}`, onPress: () => setAxis(xp, yp), style: { width: 28, height: 28, borderRadius: 5, backgroundColor: active ? "#f2b03b" : "#243244", borderWidth: 1, borderColor: "#475569" } });
      }))
    ), /* @__PURE__ */ React3.createElement(Text, { fontSize: 8, color: "#cbd5e1" }, `${xParam} ${point.x.toFixed(2)}${yParam ? ` / ${yParam} ${point.y.toFixed(2)}` : ""}`));
  }
  function StepGrid({
    track,
    sounds,
    steps = 16,
    start = 1,
    defaultPattern,
    editable = true,
    showVelocity = false,
    showProbability = false
  }) {
    const audio = useAudio();
    const [pattern, setPattern] = React3.useState(defaultPattern ?? Array.from({ length: steps }, () => "-").join(""));
    const [velocity, setVelocity] = React3.useState({});
    const [probability, setProbability] = React3.useState({});
    React3.useEffect(() => {
      audio.makePattern(sounds, track, start, normalizeHostPattern(pattern, sounds), steps);
    }, [track, start, steps, pattern, sounds]);
    const toggle = (index) => {
      if (!editable) return;
      const chars = pattern.padEnd(steps, "-").slice(0, steps).split("");
      const multi = Array.isArray(sounds) && sounds.length > 1;
      chars[index] = chars[index] === "-" ? multi ? STEP_TOKENS[index % Math.min(16, sounds.length)] : "X" : "-";
      setPattern(chars.join(""));
    };
    const bumpVelocity = (index) => {
      const next = velocity[index] == null || velocity[index] >= 1 ? 0.4 : clamp(velocity[index] + 0.2, 0, 1);
      setVelocity((prev) => ({ ...prev, [index]: next }));
      audio.setStepVelocity(track, index, next);
    };
    const bumpProbability = (index) => {
      const next = probability[index] == null || probability[index] >= 1 ? 0.25 : clamp(probability[index] + 0.25, 0, 1);
      setProbability((prev) => ({ ...prev, [index]: next }));
      audio.setStepProbability(track, index, next);
    };
    return /* @__PURE__ */ React3.createElement(Box, { style: { gap: 8 } }, /* @__PURE__ */ React3.createElement(Box, { style: { flexDirection: "row", flexWrap: "wrap", gap: 5 } }, Array.from({ length: steps }, (_, index) => {
      const token = pattern[index] ?? "-";
      const active = token !== "-";
      return /* @__PURE__ */ React3.createElement(
        Pressable,
        {
          key: index,
          onPress: () => toggle(index),
          style: {
            width: 36,
            height: 34,
            borderRadius: 6,
            backgroundColor: active ? "#f2b03b" : "#1f2933",
            borderWidth: 1,
            borderColor: active ? "#fde68a" : "#374151",
            alignItems: "center",
            justifyContent: "center"
          }
        },
        /* @__PURE__ */ React3.createElement(Text, { fontSize: 9, color: active ? "#111827" : "#cbd5e1" }, token === "-" ? String(index + 1) : token)
      );
    })), showVelocity && /* @__PURE__ */ React3.createElement(Box, { style: { flexDirection: "row", flexWrap: "wrap", gap: 5 } }, Array.from({ length: steps }, (_, index) => /* @__PURE__ */ React3.createElement(SmallButton, { key: index, label: `v${Math.round((velocity[index] ?? 0.8) * 10)}`, onPress: () => bumpVelocity(index) }))), showProbability && /* @__PURE__ */ React3.createElement(Box, { style: { flexDirection: "row", flexWrap: "wrap", gap: 5 } }, Array.from({ length: steps }, (_, index) => /* @__PURE__ */ React3.createElement(SmallButton, { key: index, label: `p${Math.round((probability[index] ?? 1) * 10)}`, onPress: () => bumpProbability(index) }))));
  }
  function StepPattern({
    steps,
    currentStep = -1,
    color = "#f2b03b",
    inactiveColor = "#969696",
    liveColor = "#f2b03b",
    levels = 3,
    editable = true,
    onChange,
    padWidth = 68,
    padHeight = 58
  }) {
    const count = Math.max(1, steps.length);
    const toggle = (index) => {
      if (!editable) return;
      const next = Array.from({ length: count }, (_, i) => {
        const value = Math.max(0, Math.min(2, Math.floor(Number(steps[i]) || 0)));
        return i === index ? cyclePatternLevel(value, levels) : value;
      });
      onChange?.(next);
    };
    return /* @__PURE__ */ React3.createElement(Box, { style: { flexDirection: "row", flexWrap: "wrap", gap: 8 } }, Array.from({ length: count }, (_, step) => {
      const level = Math.max(0, Math.min(2, Math.floor(Number(steps[step]) || 0)));
      const live = step === currentStep;
      return /* @__PURE__ */ React3.createElement(
        Pressable,
        {
          key: step,
          onPress: () => toggle(step),
          style: {
            width: padWidth,
            height: padHeight,
            borderRadius: 10,
            backgroundColor: level === 0 ? inactiveColor : color,
            borderWidth: live ? 3 : 1,
            borderColor: live ? liveColor : "#2d2d2d",
            justifyContent: "center",
            alignItems: "center",
            gap: 2
          }
        },
        /* @__PURE__ */ React3.createElement(Text, { fontSize: 14, color: level === 0 ? "#292929" : "#171717" }, String(step + 1)),
        /* @__PURE__ */ React3.createElement(Text, { fontSize: 7, color: level === 0 ? "#292929" : "#171717" }, level >= 2 ? "accent" : level === 1 ? "hit" : "rest")
      );
    }));
  }
  function StepMeter({
    steps,
    currentStep = -1,
    color = "#f2b03b",
    accentColor = "#f2b03b",
    liveColor = "#111111",
    inactiveColor = "#8c8a7f"
  }) {
    return /* @__PURE__ */ React3.createElement(Box, { style: { flexDirection: "row", gap: 3 } }, steps.map((raw, step) => {
      const level = Math.max(0, Math.min(2, Math.floor(Number(raw) || 0)));
      const isLit = level > 0;
      const live = step === currentStep;
      return /* @__PURE__ */ React3.createElement(
        Box,
        {
          key: step,
          style: {
            width: 14,
            height: 22,
            borderRadius: 3,
            backgroundColor: live ? liveColor : isLit ? color : inactiveColor,
            borderWidth: 1,
            borderColor: level >= 2 ? accentColor : "#5d5b52",
            justifyContent: "center",
            alignItems: "center"
          }
        },
        /* @__PURE__ */ React3.createElement(Text, { fontSize: 7, color: live ? "#f0dd9a" : isLit ? "#171717" : "#2f2f2f" }, String((step + 1) % 10))
      );
    }));
  }
  function LevelMeter({
    value,
    segments = 10,
    color = "#f2b03b",
    inactiveColor = "#334155",
    label,
    width = 17,
    height = 10
  }) {
    const count = Math.max(1, Math.floor(segments || 10));
    const v = clamp(Number(value) || 0, 0, 1);
    return /* @__PURE__ */ React3.createElement(Box, { style: { flexDirection: "row", gap: 3, alignItems: "center" } }, label ? /* @__PURE__ */ React3.createElement(Text, { fontSize: 8, color: "#222222" }, label) : null, Array.from({ length: count }, (_, segment) => /* @__PURE__ */ React3.createElement(
      Box,
      {
        key: segment,
        style: {
          width,
          height,
          borderRadius: 2,
          backgroundColor: v > (segment + 1) / count ? color : inactiveColor
        }
      }
    )));
  }
  function Knob({
    label,
    value,
    min = 0,
    max = 1,
    step = 0.05,
    color = "#f2b03b",
    onChange,
    formatValue
  }) {
    const v = clamp(Number(value) || 0, min, max);
    const emit = (delta) => onChange(clamp(quantize(v + delta, step), min, max));
    return /* @__PURE__ */ React3.createElement(Box, { style: { flexGrow: 1, gap: 5, alignItems: "center" } }, /* @__PURE__ */ React3.createElement(Text, { fontSize: 8, color: "#d7a742" }, label), /* @__PURE__ */ React3.createElement(Box, { style: { width: 78, height: 78, borderRadius: 39, backgroundColor: "#9f9f9f", borderWidth: 3, borderColor: "#333333", justifyContent: "center", alignItems: "center" } }, /* @__PURE__ */ React3.createElement(Box, { style: { width: 12, height: 28, borderRadius: 6, backgroundColor: color, marginBottom: 4 } }), /* @__PURE__ */ React3.createElement(Text, { fontSize: 9, color: "#111111" }, formatValue ? formatValue(v) : v.toFixed(2))), /* @__PURE__ */ React3.createElement(Box, { style: { flexDirection: "row", gap: 6 } }, /* @__PURE__ */ React3.createElement(Pressable, { onPress: () => emit(-step), style: { width: 28, height: 20, borderRadius: 10, backgroundColor: "#2e2e2e", alignItems: "center", justifyContent: "center" } }, /* @__PURE__ */ React3.createElement(Text, { fontSize: 10, color: "#f6f1e6" }, "-")), /* @__PURE__ */ React3.createElement(Pressable, { onPress: () => emit(step), style: { width: 28, height: 20, borderRadius: 10, backgroundColor: "#2e2e2e", alignItems: "center", justifyContent: "center" } }, /* @__PURE__ */ React3.createElement(Text, { fontSize: 10, color: "#f6f1e6" }, "+"))));
  }
  function TrackSelector({
    tracks,
    selected,
    onSelect,
    getId,
    getLabel,
    getColor,
    getSubtitle
  }) {
    return /* @__PURE__ */ React3.createElement(Box, { style: { flexDirection: "row", gap: 6 } }, tracks.map((track, index) => {
      const active = index === selected;
      const color = getColor(track, index);
      return /* @__PURE__ */ React3.createElement(
        Pressable,
        {
          key: getId ? getId(track, index) : String(index),
          onPress: () => onSelect(index),
          style: {
            flexGrow: 1,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: active ? "#f2b03b" : "#363636",
            backgroundColor: active ? color : "#1a1a1a",
            paddingTop: 7,
            paddingBottom: 7,
            alignItems: "center",
            gap: 2
          }
        },
        /* @__PURE__ */ React3.createElement(Text, { fontSize: 8, color: active ? "#171717" : "#b0b0b0" }, getLabel(track, index)),
        getSubtitle ? /* @__PURE__ */ React3.createElement(Text, { fontSize: 10, color: active ? "#171717" : "#f4efe3" }, getSubtitle(track, index)) : null
      );
    }));
  }
  function PatternTrack({
    track,
    sound,
    steps,
    volume = 1,
    pan = 0,
    probability = 1,
    offset = 0,
    swing = 0,
    start = 1,
    stepsPerMeasure,
    enabled = true
  }) {
    const audio = useAudio();
    const stepCount = Math.max(1, stepsPerMeasure ?? steps.length);
    const pattern = patternStringFromSteps(steps);
    const levelsKey = steps.map((step) => String(Math.max(0, Math.min(2, Math.floor(Number(step) || 0))))).join(",");
    React3.useEffect(() => {
      if (!enabled) return;
      audio.clearTrack(track);
      audio.makePattern(sound, track, start, pattern, stepCount);
      audio.setTrackVolume(track, volume);
      audio.setTrackPan(track, pan);
      audio.setTrackMute(track, false);
      audio.setTrackSolo(track, false);
      for (let step = 0; step < steps.length; step++) {
        const level = Math.max(0, Math.min(2, Math.floor(Number(steps[step]) || 0)));
        if (level > 0) {
          audio.setStepVelocity(track, step, level >= 2 ? 1 : 0.66);
          audio.setStepProbability(track, step, probability);
        }
        const swung = step % 2 === 1 ? swing * 0.42 : 0;
        audio.setStepOffset(track, step, clamp(offset + swung, -0.5, 0.5));
      }
      return () => {
        audio.clearTrack(track);
      };
    }, [enabled, track, sound, start, pattern, levelsKey, stepCount, volume, pan, probability, offset, swing]);
    return null;
  }
  function Transport({
    onPlay,
    onPause,
    onStop,
    showBpm = true,
    showTimeSig = true,
    showPosition = true,
    showMeter = false
  }) {
    const audio = useAudio();
    const [playing, setPlaying] = React3.useState(false);
    const [bpm, setBpm] = React3.useState("120");
    const [timeSig, setTimeSig] = React3.useState("4/4");
    const [position, setPosition] = React3.useState(1);
    const [peak, setPeak] = React3.useState(0);
    useInterval(() => {
      setPlaying(audio.isPlaying());
      setPosition(audio.getPlayhead());
      if (showMeter) setPeak(audio.getPeakLevel());
    }, 33);
    const commitBpm = () => {
      const n = Number(bpm);
      if (Number.isFinite(n) && n > 0) audio.setTempo(n, 1);
    };
    const commitTimeSig = () => {
      const [num, den] = timeSig.split("/").map((v) => Number(v));
      const fn = audio.setTimeSignature;
      if (typeof fn === "function" && Number.isFinite(num) && Number.isFinite(den)) fn(num, den);
    };
    return /* @__PURE__ */ React3.createElement(Box, { style: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" } }, /* @__PURE__ */ React3.createElement(SmallButton, { label: playing ? "pause" : "play", active: playing, onPress: () => {
      if (playing) {
        onPause?.();
        audio.pause();
      } else {
        onPlay?.();
        audio.play();
      }
    } }), /* @__PURE__ */ React3.createElement(SmallButton, { label: "stop", onPress: () => {
      onStop?.();
      audio.stop();
    } }), showBpm && /* @__PURE__ */ React3.createElement(Box, { style: { width: 66 } }, /* @__PURE__ */ React3.createElement(TextInput, { value: bpm, onChange: setBpm, onSubmit: commitBpm, onKeyDown: (e) => {
      if (e?.key === "Enter") commitBpm();
    }, style: { fontSize: 10, color: "#f8fafc", backgroundColor: "#111827", borderRadius: 5, padding: 6 } })), showTimeSig && /* @__PURE__ */ React3.createElement(Box, { style: { width: 54 } }, /* @__PURE__ */ React3.createElement(TextInput, { value: timeSig, onChange: setTimeSig, onSubmit: commitTimeSig, onKeyDown: (e) => {
      if (e?.key === "Enter") commitTimeSig();
    }, style: { fontSize: 10, color: "#f8fafc", backgroundColor: "#111827", borderRadius: 5, padding: 6 } })), showPosition && /* @__PURE__ */ React3.createElement(Text, { fontSize: 10, color: "#cbd5e1" }, `m ${position.toFixed(2)}`), showMeter && /* @__PURE__ */ React3.createElement(Box, { style: { flexDirection: "row", gap: 3 } }, Array.from({ length: 8 }, (_, i) => /* @__PURE__ */ React3.createElement(Box, { key: i, style: { width: 8, height: 22, borderRadius: 2, backgroundColor: peak > (i + 1) / 8 ? "#f2b03b" : "#334155" } }))));
  }
  function Scope({
    source = "master",
    mode = "waveform",
    bufferSize = 512
  }) {
    const audio = useAudio();
    const [peak, setPeak] = React3.useState(0);
    const bars = Math.max(8, Math.min(32, Math.floor(bufferSize / 32)));
    useInterval(() => {
      setPeak(source === "master" ? audio.getPeakLevel() : audio.getPeakLevel());
    }, 33);
    return /* @__PURE__ */ React3.createElement(Box, { style: { width: 220, height: 86, backgroundColor: "#0f172a", borderRadius: 8, borderWidth: 1, borderColor: "#334155", padding: 8, gap: 5 } }, /* @__PURE__ */ React3.createElement(Box, { style: { flexDirection: "row", gap: 3, alignItems: "center", height: 52 } }, Array.from({ length: bars }, (_, i) => {
      const phase = mode === "spectrum" ? (i + 1) / bars : Math.abs(Math.sin(i / bars * Math.PI * 2));
      const h2 = Math.max(3, peak * 46 * phase);
      return /* @__PURE__ */ React3.createElement(Box, { key: i, style: { width: 5, height: h2, borderRadius: 2, backgroundColor: "#38bdf8" } });
    })), /* @__PURE__ */ React3.createElement(Text, { fontSize: 8, color: "#94a3b8" }, `${source} ${mode} ${peak.toFixed(2)}`));
  }
  function ModulePanel({
    id,
    excludedParams = [],
    layout = "vertical",
    sliderOrientation
  }) {
    const audio = useAudio();
    const defs = audio.getParamDefinitions(id).filter((def) => !excludedParams.includes(def.name));
    const horizontal = layout === "horizontal" || layout === "grid";
    const orientation = sliderOrientation ?? (layout === "horizontal" ? "horizontal" : "vertical");
    return /* @__PURE__ */ React3.createElement(Box, { style: { gap: 10 } }, /* @__PURE__ */ React3.createElement(Text, { fontSize: 10, color: "#e5e7eb" }, id), /* @__PURE__ */ React3.createElement(Box, { style: { flexDirection: horizontal ? "row" : "column", flexWrap: layout === "grid" ? "wrap" : "nowrap", gap: 10 } }, defs.map((def) => /* @__PURE__ */ React3.createElement(
      Slider,
      {
        key: def.name,
        property: "param",
        target: id,
        param: def.name,
        min: def.min,
        max: def.max,
        defaultValue: def.defaultValue,
        step: (def.max - def.min) / 100,
        orientation
      }
    ))));
  }
  var React3, NOTE_NAMES, STEP_TOKENS, AudioControls;
  var init_controls = __esm({
    "runtime/audio/controls.tsx"() {
      init_audio();
      init_primitives();
      init_useInterval();
      React3 = require_react();
      NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
      STEP_TOKENS = "0123456789ABCDEF";
      AudioControls = {
        Keybed,
        Pads,
        Slider,
        XYPad,
        StepGrid,
        StepPattern,
        StepMeter,
        LevelMeter,
        Knob,
        TrackSelector,
        PatternTrack,
        Transport,
        Scope,
        ModulePanel
      };
    }
  });

  // runtime/primitives.tsx
  function isThemeTokenValue(v) {
    return typeof v === "string" && v.startsWith(THEME_PREFIX);
  }
  function hasThemeTokenValue(v) {
    if (isThemeTokenValue(v)) return true;
    if (!v || typeof v !== "object" || v instanceof Function) return false;
    if (v.$$typeof) return false;
    if (Array.isArray(v)) return v.some(hasThemeTokenValue);
    for (const key of Object.keys(v)) {
      if (key === "children" || key === "key" || key === "ref") continue;
      if (hasThemeTokenValue(v[key])) return true;
    }
    return false;
  }
  function resolveThemeValue(v, colors, styles, resolveToken2) {
    if (isThemeTokenValue(v)) return resolveToken2(v, colors, styles);
    if (!v || typeof v !== "object" || v instanceof Function) return v;
    if (v.$$typeof) return v;
    if (Array.isArray(v)) return v.map((item) => resolveThemeValue(item, colors, styles, resolveToken2));
    const out = {};
    for (const key of Object.keys(v)) {
      out[key] = key === "children" ? v[key] : resolveThemeValue(v[key], colors, styles, resolveToken2);
    }
    return out;
  }
  function useResolvedPrimitiveProps(props) {
    const theme = (init_classifier(), __toCommonJS(classifier_exports));
    const snap = theme.__useClassifierSnapshot();
    if (!props || !hasThemeTokenValue(props)) return props;
    return resolveThemeValue(props, snap.colors, snap.styles, theme.resolveToken);
  }
  function h(type, props, ...children) {
    return require_react().createElement(type, useResolvedPrimitiveProps(props), ...children);
  }
  function isInlineTextLike(el) {
    if (!el || typeof el !== "object") return false;
    const t = el.type;
    if (t == null) return false;
    if (t === Text) return true;
    if (typeof t === "function" && t.__isClassifier && t.__def?.type === "Text") return true;
    return false;
  }
  function flattenTextChildren(children) {
    if (children == null) return children;
    const list = Array.isArray(children) ? children : [children];
    const out = [];
    let buf = "";
    let bufHas = false;
    const flush = () => {
      if (bufHas) {
        out.push(buf);
        buf = "";
        bufHas = false;
      }
    };
    const visit = (c) => {
      if (c == null || c === false || c === true) return;
      const t = typeof c;
      if (t === "string" || t === "number") {
        buf += String(c);
        bufHas = true;
        return;
      }
      if (Array.isArray(c)) {
        for (const ci of c) visit(ci);
        return;
      }
      if (isInlineTextLike(c)) {
        const inner = c.props?.children;
        if (inner != null) visit(inner);
        return;
      }
      flush();
      out.push(c);
    };
    for (const c of list) visit(c);
    flush();
    if (out.length === 0) return void 0;
    if (out.length === 1) return out[0];
    return out;
  }
  function _hexToRgb(hex, fallback = [0.8, 0.8, 0.8]) {
    if (!hex || typeof hex !== "string") return fallback;
    const s = hex.startsWith("#") ? hex.slice(1) : hex;
    const expanded = s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
    if (expanded.length !== 6) return fallback;
    const n = parseInt(expanded, 16);
    if (Number.isNaN(n)) return fallback;
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }
  function _vec3(v, dx = 0, dy = 0, dz = 0) {
    if (Array.isArray(v) && v.length === 3) return [v[0] ?? dx, v[1] ?? dy, v[2] ?? dz];
    return [dx, dy, dz];
  }
  function _scaleVec3(v) {
    if (typeof v === "number") return [v, v, v];
    if (Array.isArray(v) && v.length === 3) return [v[0] ?? 1, v[1] ?? 1, v[2] ?? 1];
    return [1, 1, 1];
  }
  function _verticesJsonArray(verts) {
    return Array.isArray(verts) ? verts : Array.from(verts);
  }
  function _uploadScene3DVertices(verts) {
    const host2 = globalThis;
    if (typeof host2.__hostUploadFloatBuffer !== "function") return 0;
    const view = verts instanceof Float32Array ? verts : new Float32Array(verts);
    const handle = host2.__hostUploadFloatBuffer(view);
    return Number.isFinite(handle) && handle > 0 ? handle | 0 : 0;
  }
  function _scene3dVertexProps(key, verts, count, bounds) {
    const handle = _uploadScene3DVertices(verts);
    return handle > 0 ? { scene3dGeomKey: key, scene3dVerticesHandle: handle, scene3dVertCount: count, scene3dBoundsRadius: bounds } : { scene3dGeomKey: key, scene3dVertices: _verticesJsonArray(verts), scene3dVertCount: count, scene3dBoundsRadius: bounds };
  }
  function nativePropsEqual(prev, next) {
    const prevKeys = Object.keys(prev);
    const nextKeys = Object.keys(next);
    if (prevKeys.length !== nextKeys.length) return false;
    for (const key of nextKeys) {
      if (key === "children") continue;
      if (key.startsWith("on") && key.length > 2 && key[2] === key[2].toUpperCase()) {
        if (key in prev !== key in next) return false;
        continue;
      }
      if (prev[key] !== next[key]) return false;
    }
    return true;
  }
  function getNativeMemoized() {
    if (_NativeMemoized) return _NativeMemoized;
    const R = require_react();
    _NativeMemoized = R.memo(function NativeInner({ type, ...props }) {
      return R.createElement(type, props);
    }, nativePropsEqual);
    return _NativeMemoized;
  }
  var THEME_PREFIX, Box, Text, Image, Pressable, ScrollView, Input, TextInput, StaticSurface, PhysicsBase, _AUTO_FOG_COLOR, Scene3DBase, _hfShipCache, _hfDepthShipCache, _dynGeomCache, _DYN_GEOM_CACHE_MAX, _dynSlotShipped, AudioBase2, AudioControlsBase, CanvasBase, Canvas, GraphBase, Graph, SdfIcon, _NativeMemoized, Native;
  var init_primitives = __esm({
    "runtime/primitives.tsx"() {
      THEME_PREFIX = "theme:";
      Box = (props) => h("View", props, props.children);
      Text = (props) => {
        const { size, bold, style, children, ...rest } = props;
        const flat = flattenTextChildren(children);
        if (size == null && !bold) return h("Text", { ...rest, style }, flat);
        const shorthand = {};
        if (size != null) shorthand.fontSize = size;
        if (bold) shorthand.fontWeight = "bold";
        return h("Text", { ...rest, style: { ...shorthand, ...style ?? {} } }, flat);
      };
      Image = ({ src, source, ...rest }) => h("Image", { ...rest, source: source ?? src }, rest.children);
      Pressable = (props) => h("Pressable", props, props.children);
      ScrollView = (props) => {
        const React5 = require_react();
        const hotId = React5.useId();
        const host2 = globalThis;
        const routePath = typeof host2.__routerCurrentPath === "function" ? host2.__routerCurrentPath() ?? "" : "";
        const hotKey = "scroll:" + routePath + ":" + hotId;
        let initialY = 0;
        if (typeof host2.__hot_get === "function") {
          try {
            const raw = host2.__hot_get(hotKey);
            if (raw != null) {
              const n = parseFloat(raw);
              if (Number.isFinite(n)) initialY = n;
            }
          } catch {
          }
        }
        const userOnScroll = props.onScroll;
        const onScroll = (payload) => {
          try {
            if (typeof host2.__hot_set === "function" && Number.isFinite(payload?.scrollY)) {
              host2.__hot_set(hotKey, String(payload.scrollY));
            }
          } catch {
          }
          if (typeof userOnScroll === "function") userOnScroll(payload);
        };
        const forwardedProps = {
          ...props,
          onScroll,
          initialScrollY: props.initialScrollY ?? initialY
        };
        return h("ScrollView", forwardedProps, props.children);
      };
      Input = (props) => {
        const { type, text, value, children, ...rest } = props;
        const hostType = type === "multiline" ? "TextArea" : type === "code" ? "TextEditor" : "TextInput";
        return h(hostType, { ...rest, value: text ?? value }, children);
      };
      TextInput = (props) => Input({ ...props, type: "text" });
      StaticSurface = ({
        staticKey,
        staticSurfaceKey,
        scale,
        staticSurfaceScale,
        warmupFrames,
        staticSurfaceWarmupFrames,
        introFrames,
        staticSurfaceIntroFrames,
        ...rest
      }) => {
        const React5 = require_react();
        const id = React5.useId();
        return h("View", {
          ...rest,
          staticSurface: true,
          staticSurfaceKey: staticSurfaceKey ?? staticKey ?? id,
          staticSurfaceScale: staticSurfaceScale ?? scale ?? 1,
          staticSurfaceWarmupFrames: staticSurfaceWarmupFrames ?? warmupFrames ?? 0,
          staticSurfaceIntroFrames: staticSurfaceIntroFrames ?? introFrames ?? 0
        }, rest.children);
      };
      PhysicsBase = ({ gravityX, gravityY, ...rest }) => h("View", {
        ...rest,
        physicsWorld: true,
        physicsGravityX: gravityX ?? 0,
        physicsGravityY: gravityY ?? 980
      }, rest.children);
      PhysicsBase.World = PhysicsBase;
      PhysicsBase.Body = ({ type, x, y, angle, fixedRotation, bullet, gravityScale, ...rest }) => h("View", {
        ...rest,
        physicsBody: true,
        physicsBodyType: type ?? "dynamic",
        physicsX: x ?? 0,
        physicsY: y ?? 0,
        physicsAngle: angle ?? 0,
        physicsFixedRotation: fixedRotation ?? false,
        physicsBullet: bullet ?? false,
        physicsGravityScale: gravityScale ?? 1
      }, rest.children);
      PhysicsBase.Collider = ({ shape, radius, density, friction, restitution, ...rest }) => h("View", {
        ...rest,
        physicsCollider: true,
        physicsShape: shape ?? "box",
        physicsRadius: radius ?? 0,
        physicsDensity: density ?? 1,
        physicsFriction: friction ?? 0.3,
        physicsRestitution: restitution ?? 0.1
      }, rest.children);
      _AUTO_FOG_COLOR = [-1, -1, -1];
      Scene3DBase = ({ wireframe, ...rest }) => h("View", {
        ...rest,
        scene3d: true,
        // `wireframe` draws a screen-constant-width line along every triangle edge of
        // every mesh in this scene (host-side, barycentric — pixel-locked to the surface
        // at any zoom). A viewport-wide toggle, ideal for a mesh editor.
        scene3dWireframe: !!wireframe
      }, rest.children);
      Scene3DBase.Camera = {
        $$typeof: /* @__PURE__ */ Symbol.for("react.forward_ref"),
        render({ position, target, fov, far, near, nativeCamera, scene3dCameraNative, orbit, ...rest }, ref) {
          const [px, py, pz] = _vec3(position, 3, 2, 4);
          const [lx, ly, lz] = _vec3(target, 0, 0, 0);
          return h("View", {
            ...rest,
            ref,
            scene3dCamera: true,
            scene3dCameraNative: !!(nativeCamera ?? scene3dCameraNative),
            // `orbit` hands the view to the host's drop-to-view orbit camera (gpu/3d.zig):
            // position/look come from host orbit state seeded by __mesh_load_file and driven
            // by __model_orbit_drag/zoom, so moving the camera never re-renders the cart.
            // Distinct from nativeCamera, which binds the game FPS camera.
            scene3dCameraOrbit: !!orbit,
            scene3dPosX: px,
            scene3dPosY: py,
            scene3dPosZ: pz,
            scene3dLookX: lx,
            scene3dLookY: ly,
            scene3dLookZ: lz,
            scene3dFov: fov ?? 60,
            scene3dFar: Number.isFinite(far) && far > 0 ? far : 0,
            scene3dNear: Number.isFinite(near) && near > 0 ? near : 0
          });
        }
      };
      Scene3DBase.Skybox = ({ zenith, horizon, ground, sunDir, sunColor, sunSize, sunGlow, haze, cloud, night, ...rest }) => h("View", {
        ...rest,
        scene3dSkybox: true,
        scene3dSkyZenith: _hexToRgb(zenith, [0.16, 0.33, 0.62]),
        scene3dSkyHorizon: _hexToRgb(horizon, [0.62, 0.72, 0.86]),
        scene3dSkyGround: _hexToRgb(ground, [0.1, 0.11, 0.13]),
        scene3dSkySunDir: _vec3(sunDir, 0.4, 0.6, 0.3),
        scene3dSkySunColor: _hexToRgb(sunColor, [1, 0.93, 0.78]),
        scene3dSkySunSize: sunSize ?? 0.012,
        scene3dSkySunGlow: sunGlow ?? 0.25,
        scene3dSkyHaze: haze ?? 0.3,
        scene3dSkyCloud: cloud ?? 0,
        scene3dSkyNight: night ?? 0
      });
      Scene3DBase.Fog = ({ near, far, color, enabled = true, ...rest }) => h("View", {
        ...rest,
        scene3dFog: true,
        scene3dFogColor: typeof color === "string" ? _hexToRgb(color, _AUTO_FOG_COLOR) : _AUTO_FOG_COLOR,
        scene3dFogNear: enabled === false ? 1e7 : Number.isFinite(near) && near > 0 ? near : 0,
        scene3dFogFar: enabled === false ? 2e7 : Number.isFinite(far) && far > 0 ? far : 0
      });
      _hfShipCache = /* @__PURE__ */ new WeakMap();
      _hfDepthShipCache = /* @__PURE__ */ new WeakMap();
      _dynGeomCache = /* @__PURE__ */ new Map();
      _DYN_GEOM_CACHE_MAX = 64;
      _dynSlotShipped = /* @__PURE__ */ new Map();
      Scene3DBase.Mesh = ({
        geometry,
        params,
        material,
        color,
        position,
        rotation,
        scale,
        radius,
        tubeRadius,
        sizeX,
        sizeY,
        sizeZ,
        texture,
        textureKey,
        dynamicKey,
        heights,
        hfCols,
        hfRows,
        waveAmplitude,
        waveLength,
        waveSpeed,
        waveDirection,
        waveDirX,
        waveDirZ,
        wavePhase,
        groundFormula,
        groundData,
        hostKey,
        ...rest
      }) => {
        if (typeof hostKey === "string" && hostKey.length > 0) {
          const [hr, hg, hb] = _hexToRgb(typeof material === "string" ? material : material?.color ?? color, [0.8, 0.8, 0.82]);
          const [hpx, hpy, hpz] = _vec3(position, 0, 0, 0);
          const [hsx, hsy, hsz] = _scaleVec3(scale);
          return h("View", {
            ...rest,
            scene3dMesh: true,
            scene3dGeomKey: hostKey,
            scene3dColorR: hr,
            scene3dColorG: hg,
            scene3dColorB: hb,
            scene3dPosX: hpx,
            scene3dPosY: hpy,
            scene3dPosZ: hpz,
            scene3dScaleX: hsx,
            scene3dScaleY: hsy,
            scene3dScaleZ: hsz
          });
        }
        const groundProps = typeof groundFormula === "string" && groundFormula.length > 0 && Array.isArray(groundData) ? { scene3dGroundFormula: groundFormula, scene3dGroundData: groundData } : null;
        const matColor = typeof material === "string" ? material : material?.color ?? color;
        const [r, g, b] = _hexToRgb(matColor, [0.8, 0.8, 0.8]);
        const matOpacity = material && typeof material === "object" && Number.isFinite(material.opacity) ? Math.max(0, Math.min(1, material.opacity)) : 1;
        const [px, py, pz] = _vec3(position, 0, 0, 0);
        const [rx, ry, rz] = _vec3(rotation, 0, 0, 0);
        const [sx, sy, sz] = _scaleVec3(scale);
        const tex = texture && typeof texture === "object" ? texture : null;
        const texW = tex && Number.isFinite(tex.width) ? Math.max(0, tex.width | 0) : 0;
        const texH = tex && Number.isFinite(tex.height) ? Math.max(0, tex.height | 0) : 0;
        const texHex = tex && typeof tex.hex === "string" ? tex.hex : "";
        const texKey = typeof textureKey === "string" && textureKey.length > 0 ? textureKey : "";
        const texData = texHex && texW > 0 && texH > 0 && texHex.length === texW * texH * 8 ? texHex : "";
        const geomIntern = (init_intern(), __toCommonJS(intern_exports));
        if (geomIntern.isGeometryDef(geometry)) {
          const dyn = typeof dynamicKey === "string" && dynamicKey.length > 0 ? dynamicKey : "";
          if (dyn) {
            if (!dyn.includes("~")) {
              throw new Error(
                `<Scene3D.Mesh dynamicKey="${dyn}"> must be "<slotId>~<version>" \u2014 the '~' separator is required (e.g. "mycart.head~3"). Without it the host finds no dyn slot and silently drops the mesh.`
              );
            }
            const merged = { ...geometry.defaults || {}, ...params || {} };
            const wv = merged.wave;
            const hasWave = wv && Math.abs(wv.amplitude) > 1e-4 && wv.length > 1e-4;
            if (geometry.hostKind === "heightfield" && merged.heights && !hasWave) {
              const m = merged;
              let ship = _hfShipCache.get(m.heights);
              if (!ship) {
                const arr = Array.from(m.heights);
                let maxAbsY = 0;
                for (let n = 0; n < arr.length; n++) {
                  const a = Math.abs(arr[n]);
                  if (a > maxAbsY) maxAbsY = a;
                }
                ship = { arr, maxAbsY };
                _hfShipCache.set(m.heights, ship);
              }
              const halfW = (m.width ?? 1) / 2, halfD = (m.depth ?? 1) / 2;
              const boundsRadius = Math.sqrt(halfW * halfW + halfD * halfD + ship.maxAbsY * ship.maxAbsY);
              let depthShip;
              if (Array.isArray(m.depths) && m.depths.length === ship.arr.length) {
                depthShip = _hfDepthShipCache.get(m.depths);
                if (!depthShip) {
                  depthShip = Array.from(m.depths);
                  _hfDepthShipCache.set(m.depths, depthShip);
                }
              }
              return h("View", {
                ...rest,
                scene3dMesh: true,
                scene3dGeomKey: "~hf~" + dyn,
                scene3dHeights: ship.arr,
                ...depthShip ? { scene3dHfDepths: depthShip } : {},
                scene3dHfCols: m.cols,
                scene3dHfRows: m.rows,
                scene3dHfWidth: m.width ?? 1,
                scene3dHfDepth: m.depth ?? 1,
                scene3dHfBase: m.base ?? 0,
                scene3dBoundsRadius: boundsRadius,
                scene3dPosX: px,
                scene3dPosY: py,
                scene3dPosZ: pz,
                scene3dRotX: rx,
                scene3dRotY: ry,
                scene3dRotZ: rz,
                scene3dScaleX: sx,
                scene3dScaleY: sy,
                scene3dScaleZ: sz,
                scene3dColorR: r,
                scene3dColorG: g,
                scene3dColorB: b,
                scene3dColorA: matOpacity,
                scene3dTexW: texW,
                scene3dTexH: texH,
                scene3dTexData: texData,
                ...texKey ? { scene3dTexKey: texKey } : {},
                ...groundProps ?? {}
              });
            }
            let dynShip = _dynGeomCache.get(dyn);
            if (!dynShip) {
              const gd = geometry.generate(merged);
              dynShip = { verts: gd.positions, count: gd.count, radius: gd.bounds.radius };
              if (_dynGeomCache.size >= _DYN_GEOM_CACHE_MAX) {
                const oldest = _dynGeomCache.keys().next().value;
                if (oldest != null) _dynGeomCache.delete(oldest);
              }
              _dynGeomCache.set(dyn, dynShip);
            }
            const slotId = dyn.slice(0, dyn.lastIndexOf("~"));
            const dynGeomProps = _dynSlotShipped.get(slotId) === dyn ? { scene3dGeomKey: "~dyn~" + dyn, scene3dBoundsRadius: dynShip.radius } : _scene3dVertexProps("~dyn~" + dyn, dynShip.verts, dynShip.count, dynShip.radius);
            _dynSlotShipped.set(slotId, dyn);
            return h("View", {
              ...rest,
              scene3dMesh: true,
              ...dynGeomProps,
              scene3dPosX: px,
              scene3dPosY: py,
              scene3dPosZ: pz,
              scene3dRotX: rx,
              scene3dRotY: ry,
              scene3dRotZ: rz,
              scene3dScaleX: sx,
              scene3dScaleY: sy,
              scene3dScaleZ: sz,
              scene3dColorR: r,
              scene3dColorG: g,
              scene3dColorB: b,
              scene3dColorA: matOpacity,
              scene3dTexW: texW,
              scene3dTexH: texH,
              scene3dTexData: texData,
              ...texKey ? { scene3dTexKey: texKey } : {}
            });
          }
          const g3 = geomIntern.internGeometry(geometry, params);
          const firstForKey = !geomIntern.hasShipped(g3.key);
          if (firstForKey) geomIntern.markShipped(g3.key);
          const geomProps = firstForKey ? _scene3dVertexProps(g3.key, g3.vertices, g3.count, g3.bounds) : { scene3dGeomKey: g3.key, scene3dBoundsRadius: g3.bounds };
          return h("View", {
            ...rest,
            scene3dMesh: true,
            ...geomProps,
            scene3dPosX: px,
            scene3dPosY: py,
            scene3dPosZ: pz,
            scene3dRotX: rx,
            scene3dRotY: ry,
            scene3dRotZ: rz,
            scene3dScaleX: sx,
            scene3dScaleY: sy,
            scene3dScaleZ: sz,
            scene3dColorR: r,
            scene3dColorG: g,
            scene3dColorB: b,
            scene3dColorA: matOpacity,
            scene3dTexW: texW,
            scene3dTexH: texH,
            scene3dTexData: texData,
            ...texKey ? { scene3dTexKey: texKey } : {}
          });
        }
        const got = typeof geometry === "string" ? `"${geometry}"` : geometry == null ? String(geometry) : "a legacy object";
        throw new Error(
          `<Scene3D.Mesh geometry={...}> no longer accepts ${got}. Use a @reactjit/geometries generator + params, e.g.  import * as Geometry from '@reactjit/geometries';  <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} />. (sizeX/Y/Z \u2192 params.width/height/depth; sphere radius \u2192 params.radius; cylinder radius+sizeY \u2192 params.radius+height.)`
        );
      };
      Scene3DBase.Instances = ({
        geometry,
        params,
        data,
        count,
        stride,
        boundsRadius,
        center,
        textureKey,
        ...rest
      }) => {
        const [cx, cy, cz] = _vec3(center, 0, 0, 0);
        const geomIntern = (init_intern(), __toCommonJS(intern_exports));
        if (!geomIntern.isGeometryDef(geometry)) {
          throw new Error("<Scene3D.Instances geometry={...}> requires a @reactjit/geometries generator.");
        }
        const g3 = geomIntern.internGeometry(geometry, params);
        geomIntern.markShipped(g3.key);
        const geomProps = _scene3dVertexProps(g3.key, g3.vertices, g3.count, boundsRadius ?? g3.bounds);
        return h("View", {
          ...rest,
          scene3dMesh: true,
          ...geomProps,
          scene3dPosX: cx,
          scene3dPosY: cy,
          scene3dPosZ: cz,
          scene3dInstanceData: data,
          scene3dInstanceCount: count ?? 0,
          scene3dInstanceStride: stride ?? 9,
          ...textureKey ? { scene3dTexKey: textureKey } : {}
        });
      };
      Scene3DBase.AmbientLight = ({ color, intensity, ...rest }) => {
        const [r, g, b] = _hexToRgb(color, [1, 1, 1]);
        return h("View", {
          ...rest,
          scene3dLight: true,
          scene3dLightType: "ambient",
          scene3dColorR: r,
          scene3dColorG: g,
          scene3dColorB: b,
          scene3dIntensity: intensity ?? 0.3
        });
      };
      Scene3DBase.DirectionalLight = ({ direction, color, intensity, ...rest }) => {
        const [dx, dy, dz] = _vec3(direction, 0, -1, 0);
        const [r, g, b] = _hexToRgb(color, [1, 1, 1]);
        return h("View", {
          ...rest,
          scene3dLight: true,
          scene3dLightType: "directional",
          scene3dDirX: dx,
          scene3dDirY: dy,
          scene3dDirZ: dz,
          scene3dColorR: r,
          scene3dColorG: g,
          scene3dColorB: b,
          scene3dIntensity: intensity ?? 1
        });
      };
      Scene3DBase.PointLight = ({ position, color, intensity, range, ...rest }) => {
        const [px, py, pz] = _vec3(position, 0, 0, 0);
        const [r, g, b] = _hexToRgb(color, [1, 1, 1]);
        return h("View", {
          ...rest,
          scene3dLight: true,
          scene3dLightType: "point",
          scene3dPosX: px,
          scene3dPosY: py,
          scene3dPosZ: pz,
          scene3dColorR: r,
          scene3dColorG: g,
          scene3dColorB: b,
          scene3dIntensity: intensity ?? 1,
          scene3dRange: range ?? 0
        });
      };
      Scene3DBase.SpotLight = ({ position, direction, color, intensity, cone, range, castsShadow, ...rest }) => {
        const [px, py, pz] = _vec3(position, 0, 0, 0);
        const [dx, dy, dz] = _vec3(direction, 0, -1, 0);
        const [r, g, b] = _hexToRgb(color, [1, 1, 1]);
        return h("View", {
          ...rest,
          scene3dLight: true,
          scene3dLightType: "spot",
          scene3dPosX: px,
          scene3dPosY: py,
          scene3dPosZ: pz,
          scene3dDirX: dx,
          scene3dDirY: dy,
          scene3dDirZ: dz,
          scene3dColorR: r,
          scene3dColorG: g,
          scene3dColorB: b,
          scene3dIntensity: intensity ?? 1,
          scene3dSpread: cone ?? 30,
          scene3dRange: range ?? 0,
          scene3dCastShadow: castsShadow ?? true
        });
      };
      Scene3DBase.OrbitControls = (_props) => null;
      AudioBase2 = function Audio2(props) {
        return (init_audio(), __toCommonJS(audio_exports)).Audio(props);
      };
      AudioBase2.Module = function Module(props) {
        return (init_audio(), __toCommonJS(audio_exports)).Audio.Module(props);
      };
      AudioBase2.Connection = function Connection(props) {
        return (init_audio(), __toCommonJS(audio_exports)).Audio.Connection(props);
      };
      AudioControlsBase = {};
      AudioControlsBase.Keybed = function Keybed2(props) {
        return (init_controls(), __toCommonJS(controls_exports)).AudioControls.Keybed(props);
      };
      AudioControlsBase.Pads = function Pads2(props) {
        return (init_controls(), __toCommonJS(controls_exports)).AudioControls.Pads(props);
      };
      AudioControlsBase.Slider = function Slider2(props) {
        return (init_controls(), __toCommonJS(controls_exports)).AudioControls.Slider(props);
      };
      AudioControlsBase.XYPad = function XYPad2(props) {
        return (init_controls(), __toCommonJS(controls_exports)).AudioControls.XYPad(props);
      };
      AudioControlsBase.StepGrid = function StepGrid2(props) {
        return (init_controls(), __toCommonJS(controls_exports)).AudioControls.StepGrid(props);
      };
      AudioControlsBase.StepPattern = function StepPattern2(props) {
        return (init_controls(), __toCommonJS(controls_exports)).AudioControls.StepPattern(props);
      };
      AudioControlsBase.StepMeter = function StepMeter2(props) {
        return (init_controls(), __toCommonJS(controls_exports)).AudioControls.StepMeter(props);
      };
      AudioControlsBase.LevelMeter = function LevelMeter2(props) {
        return (init_controls(), __toCommonJS(controls_exports)).AudioControls.LevelMeter(props);
      };
      AudioControlsBase.Knob = function Knob2(props) {
        return (init_controls(), __toCommonJS(controls_exports)).AudioControls.Knob(props);
      };
      AudioControlsBase.TrackSelector = function TrackSelector2(props) {
        return (init_controls(), __toCommonJS(controls_exports)).AudioControls.TrackSelector(props);
      };
      AudioControlsBase.PatternTrack = function PatternTrack2(props) {
        return (init_controls(), __toCommonJS(controls_exports)).AudioControls.PatternTrack(props);
      };
      AudioControlsBase.Transport = function Transport2(props) {
        return (init_controls(), __toCommonJS(controls_exports)).AudioControls.Transport(props);
      };
      AudioControlsBase.Scope = function Scope2(props) {
        return (init_controls(), __toCommonJS(controls_exports)).AudioControls.Scope(props);
      };
      AudioControlsBase.ModulePanel = function ModulePanel2(props) {
        return (init_controls(), __toCommonJS(controls_exports)).AudioControls.ModulePanel(props);
      };
      CanvasBase = (props) => h("Canvas", props, props.children);
      CanvasBase.Node = (props) => h("Canvas.Node", props, props.children);
      CanvasBase.Path = (props) => h("Canvas.Path", props, props.children);
      CanvasBase.Clamp = (props) => h("Canvas.Clamp", props, props.children);
      Canvas = CanvasBase;
      GraphBase = (props) => h("Graph", props, props.children);
      GraphBase.Path = (props) => h("Graph.Path", props, props.children);
      GraphBase.Node = (props) => h("Graph.Node", props, props.children);
      GraphBase.Polyline = ({ segments, ...props }) => h("Graph.Polyline", segments ? { ...props, polylineSegments: true } : props, props.children);
      GraphBase.Polygon = (props) => h("Graph.Polygon", props, props.children);
      GraphBase.GCurve = (props) => h("Graph.GCurve", props, props.children);
      Graph = GraphBase;
      SdfIcon = ({ name, color, size, ...rest }) => h("View", {
        ...rest,
        iconName: name,
        style: {
          width: size ?? 16,
          height: size ?? 16,
          color: color ?? "theme:ink",
          ...rest.style ?? {}
        }
      });
      _NativeMemoized = null;
      Native = function Native2(props) {
        return h(getNativeMemoized(), props);
      };
    }
  });

  // runtime/icons/registry.ts
  function toPascalCase(s) {
    return s.replace(/(^|[-_])([a-z0-9])/g, (_, __, c) => c.toUpperCase()).replace(/[-_]/g, "");
  }
  function lookupIcon(name) {
    const direct = registry.get(name);
    if (direct) return direct;
    const canonical = lowerMap.get(name.toLowerCase());
    if (canonical) return registry.get(canonical);
    const pascal = toPascalCase(name);
    const pascalHit = registry.get(pascal);
    if (pascalHit) return pascalHit;
    const alias = ALIASES[name] || ALIASES[name.toLowerCase()];
    if (alias) {
      const aliasHit = registry.get(alias);
      if (aliasHit) return aliasHit;
      const caseFix = lowerMap.get(alias.toLowerCase());
      if (caseFix) return registry.get(caseFix);
    }
    return void 0;
  }
  var registry, lowerMap, ALIASES;
  var init_registry = __esm({
    "runtime/icons/registry.ts"() {
      registry = /* @__PURE__ */ new Map();
      lowerMap = /* @__PURE__ */ new Map();
      ALIASES = {
        "stop": "CircleStop",
        "search": "Search",
        "settings": "Settings",
        "menu": "Menu",
        "mouse": "MousePointer",
        "atom": "Atom",
        "cloud-rain": "CloudRain",
        "flask": "FlaskConical",
        "presentation": "Presentation",
        "rss": "Rss",
        "trending-up": "TrendingUp",
        "home": "Home",
        "folder": "Folder",
        "folder-open": "FolderOpen",
        "file": "File",
        "file-code": "FileCode",
        "file-json": "FileJson",
        "file-text": "FileText",
        "trash": "Trash2",
        "edit": "Pencil",
        "copy": "Copy",
        "paste": "ClipboardPaste",
        "save": "Save",
        "download": "Download",
        "upload": "Upload",
        "refresh": "RefreshCw",
        "close": "X",
        "check": "Check",
        "plus": "Plus",
        "minus": "Minus",
        "info": "Info",
        "warning": "TriangleAlert",
        "warn": "TriangleAlert",
        "error": "CircleX",
        "help": "CircleHelp",
        "question-mark": "CircleHelp",
        "link": "Link",
        "unlink": "Unlink",
        "lock": "Lock",
        "unlock": "Unlock",
        "eye": "Eye",
        "eye-off": "EyeOff",
        "star": "Star",
        "heart": "Heart",
        "bookmark": "Bookmark",
        "pin": "Pin",
        "filter": "Filter",
        "sort": "ArrowUpDown",
        "arrow-left": "ArrowLeft",
        "arrow-right": "ArrowRight",
        "arrow-up": "ArrowUp",
        "arrow-down": "ArrowDown",
        "chevron-left": "ChevronLeft",
        "chevron-right": "ChevronRight",
        "chevron-up": "ChevronUp",
        "chevron-down": "ChevronDown",
        "move": "Move",
        "maximize": "Maximize",
        "minimize": "Minimize",
        "expand": "Expand",
        "shrink": "Shrink",
        "external-link": "ExternalLink",
        "image": "Image",
        "video": "Video",
        "music": "Music",
        "camera": "Camera",
        "mic": "Mic",
        "volume": "Volume2",
        "speaker": "Speaker",
        "database": "Database",
        "table": "Table",
        "chart": "ChartLine",
        "code": "Code",
        "terminal": "Terminal",
        "git": "GitBranch",
        "git-branch": "GitBranch",
        "git-commit": "GitCommitHorizontal",
        "bug": "Bug",
        "cpu": "Cpu",
        "globe": "Globe",
        "server": "Server",
        "cloud": "Cloud",
        "wifi": "Wifi",
        "zap": "Zap",
        "sun": "Sun",
        "moon": "Moon",
        "clock": "Clock",
        "calendar": "Calendar",
        "mail": "Mail",
        "message": "MessageSquare",
        "chat": "MessageSquare",
        "send": "Send",
        "phone": "Phone",
        "user": "User",
        "users": "Users",
        "shield": "Shield",
        "key": "Key",
        "tag": "Tag",
        "box": "Box",
        "package": "Package",
        "layers": "Layers",
        "grid": "Grid3x3",
        "list": "List",
        "hash": "Hash",
        "at": "AtSign",
        "at-sign": "AtSign",
        "alert": "TriangleAlert",
        "bell": "Bell",
        "book": "Book",
        "book-open": "BookOpen",
        "map": "Map",
        "compass": "Compass",
        "flag": "Flag",
        "target": "Target",
        "palette": "Palette",
        "ruler": "Ruler",
        "keyboard": "Keyboard",
        "play": "Play",
        "pause": "Pause",
        "scissors": "Scissors",
        "bot": "Bot",
        "sparkles": "Sparkles",
        "panel-left": "PanelLeft",
        "panel-right": "PanelRight",
        "panel-bottom": "PanelBottom",
        "pencil": "Pencil",
        "dots-vertical": "EllipsisVertical",
        "x": "X",
        "braces": "Braces",
        "command": "Command",
        "flame": "Flame",
        "graph": "Waypoints",
        "network": "Network",
        "wallet": "Wallet",
        "house": "Home"
      };
    }
  });

  // runtime/icons/baked-names.ts
  var BAKED_ICON_NAMES;
  var init_baked_names = __esm({
    "runtime/icons/baked-names.ts"() {
      BAKED_ICON_NAMES = /* @__PURE__ */ new Set([
        "AArrowDown",
        "AArrowUp",
        "ALargeSmall",
        "Accessibility",
        "ActivitySquare",
        "Activity",
        "AirVent",
        "Airplay",
        "AlarmCheck",
        "AlarmClockCheck",
        "AlarmClockMinus",
        "AlarmClockOff",
        "AlarmClockPlus",
        "AlarmClock",
        "AlarmMinus",
        "AlarmPlus",
        "AlarmSmoke",
        "Album",
        "AlertCircle",
        "AlertOctagon",
        "AlertTriangle",
        "AlignCenterHorizontal",
        "AlignCenterVertical",
        "AlignCenter",
        "AlignEndHorizontal",
        "AlignEndVertical",
        "AlignHorizontalDistributeCenter",
        "AlignHorizontalDistributeEnd",
        "AlignHorizontalDistributeStart",
        "AlignHorizontalJustifyCenter",
        "AlignHorizontalJustifyEnd",
        "AlignHorizontalJustifyStart",
        "AlignHorizontalSpaceAround",
        "AlignHorizontalSpaceBetween",
        "AlignJustify",
        "AlignLeft",
        "AlignRight",
        "AlignStartHorizontal",
        "AlignStartVertical",
        "AlignVerticalDistributeCenter",
        "AlignVerticalDistributeEnd",
        "AlignVerticalDistributeStart",
        "AlignVerticalJustifyCenter",
        "AlignVerticalJustifyEnd",
        "AlignVerticalJustifyStart",
        "AlignVerticalSpaceAround",
        "AlignVerticalSpaceBetween",
        "Ambulance",
        "Ampersand",
        "Ampersands",
        "Amphora",
        "Anchor",
        "Angry",
        "Annoyed",
        "Antenna",
        "Anvil",
        "Aperture",
        "AppWindowMac",
        "AppWindow",
        "Apple",
        "ArchiveRestore",
        "ArchiveX",
        "Archive",
        "AreaChart",
        "Armchair",
        "ArrowBigDownDash",
        "ArrowBigDown",
        "ArrowBigLeftDash",
        "ArrowBigLeft",
        "ArrowBigRightDash",
        "ArrowBigRight",
        "ArrowBigUpDash",
        "ArrowBigUp",
        "ArrowDown0_1",
        "ArrowDown01",
        "ArrowDown1_0",
        "ArrowDown10",
        "ArrowDownAZ",
        "ArrowDownAz",
        "ArrowDownCircle",
        "ArrowDownFromLine",
        "ArrowDownLeftFromCircle",
        "ArrowDownLeftFromSquare",
        "ArrowDownLeftSquare",
        "ArrowDownLeft",
        "ArrowDownNarrowWide",
        "ArrowDownRightFromCircle",
        "ArrowDownRightFromSquare",
        "ArrowDownRightSquare",
        "ArrowDownRight",
        "ArrowDownSquare",
        "ArrowDownToDot",
        "ArrowDownToLine",
        "ArrowDownUp",
        "ArrowDownWideNarrow",
        "ArrowDownZA",
        "ArrowDownZa",
        "ArrowDown",
        "ArrowLeftCircle",
        "ArrowLeftFromLine",
        "ArrowLeftRight",
        "ArrowLeftSquare",
        "ArrowLeftToLine",
        "ArrowLeft",
        "ArrowRightCircle",
        "ArrowRightFromLine",
        "ArrowRightLeft",
        "ArrowRightSquare",
        "ArrowRightToLine",
        "ArrowRight",
        "ArrowUp0_1",
        "ArrowUp01",
        "ArrowUp1_0",
        "ArrowUp10",
        "ArrowUpAZ",
        "ArrowUpAz",
        "ArrowUpCircle",
        "ArrowUpDown",
        "ArrowUpFromDot",
        "ArrowUpFromLine",
        "ArrowUpLeftFromCircle",
        "ArrowUpLeftFromSquare",
        "ArrowUpLeftSquare",
        "ArrowUpLeft",
        "ArrowUpNarrowWide",
        "ArrowUpRightFromCircle",
        "ArrowUpRightFromSquare",
        "ArrowUpRightSquare",
        "ArrowUpRight",
        "ArrowUpSquare",
        "ArrowUpToLine",
        "ArrowUpWideNarrow",
        "ArrowUpZA",
        "ArrowUpZa",
        "ArrowUp",
        "ArrowsUpFromLine",
        "AsteriskSquare",
        "Asterisk",
        "AtSign",
        "Atom",
        "AudioLines",
        "AudioWaveform",
        "Award",
        "Axe",
        "Axis3D",
        "Axis3d",
        "Baby",
        "Backpack",
        "BadgeAlert",
        "BadgeCent",
        "BadgeCheck",
        "BadgeDollarSign",
        "BadgeEuro",
        "BadgeHelp",
        "BadgeIndianRupee",
        "BadgeInfo",
        "BadgeJapaneseYen",
        "BadgeMinus",
        "BadgePercent",
        "BadgePlus",
        "BadgePoundSterling",
        "BadgeQuestionMark",
        "BadgeRussianRuble",
        "BadgeSwissFranc",
        "BadgeTurkishLira",
        "BadgeX",
        "Badge",
        "BaggageClaim",
        "Balloon",
        "Ban",
        "Banana",
        "Bandage",
        "BanknoteArrowDown",
        "BanknoteArrowUp",
        "BanknoteX",
        "Banknote",
        "BarChart2",
        "BarChart3",
        "BarChart4",
        "BarChartBig",
        "BarChartHorizontalBig",
        "BarChartHorizontal",
        "BarChart",
        "Barcode",
        "Barrel",
        "Baseline",
        "Bath",
        "BatteryCharging",
        "BatteryFull",
        "BatteryLow",
        "BatteryMedium",
        "BatteryPlus",
        "BatteryWarning",
        "Battery",
        "Beaker",
        "BeanOff",
        "Bean",
        "BedDouble",
        "BedSingle",
        "Bed",
        "Beef",
        "BeerOff",
        "Beer",
        "BellDot",
        "BellElectric",
        "BellMinus",
        "BellOff",
        "BellPlus",
        "BellRing",
        "Bell",
        "BetweenHorizonalEnd",
        "BetweenHorizonalStart",
        "BetweenHorizontalEnd",
        "BetweenHorizontalStart",
        "BetweenVerticalEnd",
        "BetweenVerticalStart",
        "BicepsFlexed",
        "Bike",
        "Binary",
        "Binoculars",
        "Biohazard",
        "Bird",
        "Birdhouse",
        "Bitcoin",
        "Blend",
        "Blinds",
        "Blocks",
        "BluetoothConnected",
        "BluetoothOff",
        "BluetoothSearching",
        "Bluetooth",
        "Bold",
        "Bolt",
        "Bomb",
        "Bone",
        "BookA",
        "BookAlert",
        "BookAudio",
        "BookCheck",
        "BookCopy",
        "BookDashed",
        "BookDown",
        "BookHeadphones",
        "BookHeart",
        "BookImage",
        "BookKey",
        "BookLock",
        "BookMarked",
        "BookMinus",
        "BookOpenCheck",
        "BookOpenText",
        "BookOpen",
        "BookPlus",
        "BookSearch",
        "BookTemplate",
        "BookText",
        "BookType",
        "BookUp2",
        "BookUp",
        "BookUser",
        "BookX",
        "Book",
        "BookmarkCheck",
        "BookmarkMinus",
        "BookmarkPlus",
        "BookmarkX",
        "Bookmark",
        "BoomBox",
        "BotMessageSquare",
        "BotOff",
        "Bot",
        "BottleWine",
        "BowArrow",
        "BoxSelect",
        "Box",
        "Boxes",
        "Braces",
        "Brackets",
        "BrainCircuit",
        "BrainCog",
        "Brain",
        "BrickWallFire",
        "BrickWallShield",
        "BrickWall",
        "BriefcaseBusiness",
        "BriefcaseConveyorBelt",
        "BriefcaseMedical",
        "Briefcase",
        "BringToFront",
        "BrushCleaning",
        "Brush",
        "Bubbles",
        "BugOff",
        "BugPlay",
        "Bug",
        "Building2",
        "Building",
        "BusFront",
        "Bus",
        "CableCar",
        "Cable",
        "CakeSlice",
        "Cake",
        "Calculator",
        "Calendar1",
        "CalendarArrowDown",
        "CalendarArrowUp",
        "CalendarCheck2",
        "CalendarCheck",
        "CalendarClock",
        "CalendarCog",
        "CalendarDays",
        "CalendarFold",
        "CalendarHeart",
        "CalendarMinus2",
        "CalendarMinus",
        "CalendarOff",
        "CalendarPlus2",
        "CalendarPlus",
        "CalendarRange",
        "CalendarSearch",
        "CalendarSync",
        "CalendarX2",
        "CalendarX",
        "Calendar",
        "Calendars",
        "CameraOff",
        "Camera",
        "CandlestickChart",
        "CandyCane",
        "CandyOff",
        "Candy",
        "CannabisOff",
        "Cannabis",
        "CaptionsOff",
        "Captions",
        "CarFront",
        "CarTaxiFront",
        "Car",
        "Caravan",
        "CardSim",
        "Carrot",
        "CaseLower",
        "CaseSensitive",
        "CaseUpper",
        "CassetteTape",
        "Cast",
        "Castle",
        "Cat",
        "Cctv",
        "ChartArea",
        "ChartBarBig",
        "ChartBarDecreasing",
        "ChartBarIncreasing",
        "ChartBarStacked",
        "ChartBar",
        "ChartCandlestick",
        "ChartColumnBig",
        "ChartColumnDecreasing",
        "ChartColumnIncreasing",
        "ChartColumnStacked",
        "ChartColumn",
        "ChartGantt",
        "ChartLine",
        "ChartNetwork",
        "ChartNoAxesColumnDecreasing",
        "ChartNoAxesColumnIncreasing",
        "ChartNoAxesColumn",
        "ChartNoAxesCombined",
        "ChartNoAxesGantt",
        "ChartPie",
        "ChartScatter",
        "ChartSpline",
        "CheckCheck",
        "CheckCircle2",
        "CheckCircle",
        "CheckLine",
        "CheckSquare2",
        "CheckSquare",
        "Check",
        "ChefHat",
        "Cherry",
        "ChessBishop",
        "ChessKing",
        "ChessKnight",
        "ChessPawn",
        "ChessQueen",
        "ChessRook",
        "ChevronDownCircle",
        "ChevronDownSquare",
        "ChevronDown",
        "ChevronFirst",
        "ChevronLast",
        "ChevronLeftCircle",
        "ChevronLeftSquare",
        "ChevronLeft",
        "ChevronRightCircle",
        "ChevronRightSquare",
        "ChevronRight",
        "ChevronUpCircle",
        "ChevronUpSquare",
        "ChevronUp",
        "ChevronsDownUp",
        "ChevronsDown",
        "ChevronsLeftRightEllipsis",
        "ChevronsLeftRight",
        "ChevronsLeft",
        "ChevronsRightLeft",
        "ChevronsRight",
        "ChevronsUpDown",
        "ChevronsUp",
        "Chrome",
        "Chromium",
        "Church",
        "CigaretteOff",
        "Cigarette",
        "CircleAlert",
        "CircleArrowDown",
        "CircleArrowLeft",
        "CircleArrowOutDownLeft",
        "CircleArrowOutDownRight",
        "CircleArrowOutUpLeft",
        "CircleArrowOutUpRight",
        "CircleArrowRight",
        "CircleArrowUp",
        "CircleCheckBig",
        "CircleCheck",
        "CircleChevronDown",
        "CircleChevronLeft",
        "CircleChevronRight",
        "CircleChevronUp",
        "CircleDashed",
        "CircleDivide",
        "CircleDollarSign",
        "CircleDotDashed",
        "CircleDot",
        "CircleEllipsis",
        "CircleEqual",
        "CircleFadingArrowUp",
        "CircleFadingPlus",
        "CircleGauge",
        "CircleHelp",
        "CircleMinus",
        "CircleOff",
        "CircleParkingOff",
        "CircleParking",
        "CirclePause",
        "CirclePercent",
        "CirclePile",
        "CirclePlay",
        "CirclePlus",
        "CirclePoundSterling",
        "CirclePower",
        "CircleQuestionMark",
        "CircleSlash2",
        "CircleSlash",
        "CircleSlashed",
        "CircleSmall",
        "CircleStar",
        "CircleStop",
        "CircleUserRound",
        "CircleUser",
        "CircleX",
        "Circle",
        "CircuitBoard",
        "Citrus",
        "Clapperboard",
        "ClipboardCheck",
        "ClipboardClock",
        "ClipboardCopy",
        "ClipboardEdit",
        "ClipboardList",
        "ClipboardMinus",
        "ClipboardPaste",
        "ClipboardPenLine",
        "ClipboardPen",
        "ClipboardPlus",
        "ClipboardSignature",
        "ClipboardType",
        "ClipboardX",
        "Clipboard",
        "Clock1",
        "Clock10",
        "Clock11",
        "Clock12",
        "Clock2",
        "Clock3",
        "Clock4",
        "Clock5",
        "Clock6",
        "Clock7",
        "Clock8",
        "Clock9",
        "ClockAlert",
        "ClockArrowDown",
        "ClockArrowUp",
        "ClockCheck",
        "ClockFading",
        "ClockPlus",
        "Clock",
        "ClosedCaption",
        "CloudAlert",
        "CloudBackup",
        "CloudCheck",
        "CloudCog",
        "CloudDownload",
        "CloudDrizzle",
        "CloudFog",
        "CloudHail",
        "CloudLightning",
        "CloudMoonRain",
        "CloudMoon",
        "CloudOff",
        "CloudRainWind",
        "CloudRain",
        "CloudSnow",
        "CloudSunRain",
        "CloudSun",
        "CloudSync",
        "CloudUpload",
        "Cloud",
        "Cloudy",
        "Clover",
        "Club",
        "Code2",
        "CodeSquare",
        "CodeXml",
        "Code",
        "Codepen",
        "Codesandbox",
        "Coffee",
        "Cog",
        "Coins",
        "Columns2",
        "Columns3Cog",
        "Columns3",
        "Columns4",
        "ColumnsSettings",
        "Columns",
        "Combine",
        "Command",
        "Compass",
        "Component",
        "Computer",
        "ConciergeBell",
        "Cone",
        "Construction",
        "Contact2",
        "ContactRound",
        "Contact",
        "Container",
        "Contrast",
        "Cookie",
        "CookingPot",
        "CopyCheck",
        "CopyMinus",
        "CopyPlus",
        "CopySlash",
        "CopyX",
        "Copy",
        "Copyleft",
        "Copyright",
        "CornerDownLeft",
        "CornerDownRight",
        "CornerLeftDown",
        "CornerLeftUp",
        "CornerRightDown",
        "CornerRightUp",
        "CornerUpLeft",
        "CornerUpRight",
        "Cpu",
        "CreativeCommons",
        "CreditCard",
        "Croissant",
        "Crop",
        "Cross",
        "Crosshair",
        "Crown",
        "Cuboid",
        "CupSoda",
        "CurlyBraces",
        "Currency",
        "Cylinder",
        "Dam",
        "DatabaseBackup",
        "DatabaseSearch",
        "DatabaseZap",
        "Database",
        "DecimalsArrowLeft",
        "DecimalsArrowRight",
        "Delete",
        "Dessert",
        "Diameter",
        "DiamondMinus",
        "DiamondPercent",
        "DiamondPlus",
        "Diamond",
        "Dice1",
        "Dice2",
        "Dice3",
        "Dice4",
        "Dice5",
        "Dice6",
        "Dices",
        "Diff",
        "Disc2",
        "Disc3",
        "DiscAlbum",
        "Disc",
        "DivideCircle",
        "DivideSquare",
        "Divide",
        "DnaOff",
        "Dna",
        "Dock",
        "Dog",
        "DollarSign",
        "Donut",
        "DoorClosedLocked",
        "DoorClosed",
        "DoorOpen",
        "DotSquare",
        "Dot",
        "DownloadCloud",
        "Download",
        "DraftingCompass",
        "Drama",
        "Dribbble",
        "Drill",
        "Drone",
        "DropletOff",
        "Droplet",
        "Droplets",
        "Drum",
        "Drumstick",
        "Dumbbell",
        "EarOff",
        "Ear",
        "EarthLock",
        "Earth",
        "Eclipse",
        "Edit2",
        "Edit3",
        "Edit",
        "EggFried",
        "EggOff",
        "Egg",
        "EllipsisVertical",
        "Ellipsis",
        "EqualApproximately",
        "EqualNot",
        "EqualSquare",
        "Equal",
        "Eraser",
        "EthernetPort",
        "Euro",
        "EvCharger",
        "Expand",
        "ExternalLink",
        "EyeClosed",
        "EyeOff",
        "Eye",
        "Facebook",
        "Factory",
        "Fan",
        "FastForward",
        "Feather",
        "Fence",
        "FerrisWheel",
        "Figma",
        "FileArchive",
        "FileAudio2",
        "FileAudio",
        "FileAxis3D",
        "FileAxis3d",
        "FileBadge2",
        "FileBadge",
        "FileBarChart2",
        "FileBarChart",
        "FileBox",
        "FileBracesCorner",
        "FileBraces",
        "FileChartColumnIncreasing",
        "FileChartColumn",
        "FileChartLine",
        "FileChartPie",
        "FileCheck2",
        "FileCheckCorner",
        "FileCheck",
        "FileClock",
        "FileCode2",
        "FileCodeCorner",
        "FileCode",
        "FileCog2",
        "FileCog",
        "FileDiff",
        "FileDigit",
        "FileDown",
        "FileEdit",
        "FileExclamationPoint",
        "FileHeadphone",
        "FileHeart",
        "FileImage",
        "FileInput",
        "FileJson2",
        "FileJson",
        "FileKey2",
        "FileKey",
        "FileLineChart",
        "FileLock2",
        "FileLock",
        "FileMinus2",
        "FileMinusCorner",
        "FileMinus",
        "FileMusic",
        "FileOutput",
        "FilePenLine",
        "FilePen",
        "FilePieChart",
        "FilePlay",
        "FilePlus2",
        "FilePlusCorner",
        "FilePlus",
        "FileQuestionMark",
        "FileQuestion",
        "FileScan",
        "FileSearch2",
        "FileSearchCorner",
        "FileSearch",
        "FileSignal",
        "FileSignature",
        "FileSliders",
        "FileSpreadsheet",
        "FileStack",
        "FileSymlink",
        "FileTerminal",
        "FileText",
        "FileType2",
        "FileTypeCorner",
        "FileType",
        "FileUp",
        "FileUser",
        "FileVideo2",
        "FileVideoCamera",
        "FileVideo",
        "FileVolume2",
        "FileVolume",
        "FileWarning",
        "FileX2",
        "FileXCorner",
        "FileX",
        "File",
        "Files",
        "Film",
        "FilterX",
        "Filter",
        "FingerprintPattern",
        "Fingerprint",
        "FireExtinguisher",
        "FishOff",
        "FishSymbol",
        "Fish",
        "FishingHook",
        "FlagOff",
        "FlagTriangleLeft",
        "FlagTriangleRight",
        "Flag",
        "FlameKindling",
        "Flame",
        "FlashlightOff",
        "Flashlight",
        "FlaskConicalOff",
        "FlaskConical",
        "FlaskRound",
        "FlipHorizontal2",
        "FlipHorizontal",
        "FlipVertical2",
        "FlipVertical",
        "Flower2",
        "Flower",
        "Focus",
        "FoldHorizontal",
        "FoldVertical",
        "FolderArchive",
        "FolderCheck",
        "FolderClock",
        "FolderClosed",
        "FolderCode",
        "FolderCog2",
        "FolderCog",
        "FolderDot",
        "FolderDown",
        "FolderEdit",
        "FolderGit2",
        "FolderGit",
        "FolderHeart",
        "FolderInput",
        "FolderKanban",
        "FolderKey",
        "FolderLock",
        "FolderMinus",
        "FolderOpenDot",
        "FolderOpen",
        "FolderOutput",
        "FolderPen",
        "FolderPlus",
        "FolderRoot",
        "FolderSearch2",
        "FolderSearch",
        "FolderSymlink",
        "FolderSync",
        "FolderTree",
        "FolderUp",
        "FolderX",
        "Folder",
        "Folders",
        "Footprints",
        "ForkKnifeCrossed",
        "ForkKnife",
        "Forklift",
        "FormInput",
        "Form",
        "Forward",
        "Frame",
        "Framer",
        "Frown",
        "Fuel",
        "Fullscreen",
        "FunctionSquare",
        "FunnelPlus",
        "FunnelX",
        "Funnel",
        "GalleryHorizontalEnd",
        "GalleryHorizontal",
        "GalleryThumbnails",
        "GalleryVerticalEnd",
        "GalleryVertical",
        "Gamepad2",
        "GamepadDirectional",
        "Gamepad",
        "GanttChartSquare",
        "GanttChart",
        "GaugeCircle",
        "Gauge",
        "Gavel",
        "Gem",
        "GeorgianLari",
        "Ghost",
        "Gift",
        "GitBranchMinus",
        "GitBranchPlus",
        "GitBranch",
        "GitCommitHorizontal",
        "GitCommitVertical",
        "GitCommit",
        "GitCompareArrows",
        "GitCompare",
        "GitFork",
        "GitGraph",
        "GitMergeConflict",
        "GitMerge",
        "GitPullRequestArrow",
        "GitPullRequestClosed",
        "GitPullRequestCreateArrow",
        "GitPullRequestCreate",
        "GitPullRequestDraft",
        "GitPullRequest",
        "Github",
        "Gitlab",
        "GlassWater",
        "Glasses",
        "Globe2",
        "GlobeLock",
        "GlobeOff",
        "GlobeX",
        "Globe",
        "Goal",
        "Gpu",
        "Grab",
        "GraduationCap",
        "Grape",
        "Grid2X2Check",
        "Grid2X2Plus",
        "Grid2X2X",
        "Grid2X2",
        "Grid2x2Check",
        "Grid2x2Plus",
        "Grid2x2X",
        "Grid2x2",
        "Grid3X3",
        "Grid3x2",
        "Grid3x3",
        "Grid",
        "GripHorizontal",
        "GripVertical",
        "Grip",
        "Group",
        "Guitar",
        "Ham",
        "Hamburger",
        "Hammer",
        "HandCoins",
        "HandFist",
        "HandGrab",
        "HandHeart",
        "HandHelping",
        "HandMetal",
        "HandPlatter",
        "Hand",
        "Handbag",
        "Handshake",
        "HardDriveDownload",
        "HardDriveUpload",
        "HardDrive",
        "HardHat",
        "Hash",
        "HatGlasses",
        "Haze",
        "Hd",
        "HdmiPort",
        "Heading1",
        "Heading2",
        "Heading3",
        "Heading4",
        "Heading5",
        "Heading6",
        "Heading",
        "HeadphoneOff",
        "Headphones",
        "Headset",
        "HeartCrack",
        "HeartHandshake",
        "HeartMinus",
        "HeartOff",
        "HeartPlus",
        "HeartPulse",
        "Heart",
        "Heater",
        "Helicopter",
        "HelpCircle",
        "HelpingHand",
        "Hexagon",
        "Highlighter",
        "History",
        "Home",
        "HopOff",
        "Hop",
        "Hospital",
        "Hotel",
        "Hourglass",
        "HouseHeart",
        "HousePlug",
        "HousePlus",
        "HouseWifi",
        "House",
        "IceCream2",
        "IceCreamBowl",
        "IceCreamCone",
        "IceCream",
        "IdCardLanyard",
        "IdCard",
        "ImageDown",
        "ImageMinus",
        "ImageOff",
        "ImagePlay",
        "ImagePlus",
        "ImageUp",
        "ImageUpscale",
        "Image",
        "Images",
        "Import",
        "Inbox",
        "IndentDecrease",
        "IndentIncrease",
        "Indent",
        "IndianRupee",
        "Infinity",
        "Info",
        "Inspect",
        "InspectionPanel",
        "Instagram",
        "Italic",
        "IterationCcw",
        "IterationCw",
        "JapaneseYen",
        "Joystick",
        "KanbanSquareDashed",
        "KanbanSquare",
        "Kanban",
        "Kayak",
        "KeyRound",
        "KeySquare",
        "Key",
        "KeyboardMusic",
        "KeyboardOff",
        "Keyboard",
        "LampCeiling",
        "LampDesk",
        "LampFloor",
        "LampWallDown",
        "LampWallUp",
        "Lamp",
        "LandPlot",
        "Landmark",
        "Languages",
        "Laptop2",
        "LaptopMinimalCheck",
        "LaptopMinimal",
        "Laptop",
        "LassoSelect",
        "Lasso",
        "Laugh",
        "Layers2",
        "Layers3",
        "LayersPlus",
        "Layers",
        "LayoutDashboard",
        "LayoutGrid",
        "LayoutList",
        "LayoutPanelLeft",
        "LayoutPanelTop",
        "LayoutTemplate",
        "Layout",
        "Leaf",
        "LeafyGreen",
        "Lectern",
        "LensConcave",
        "LensConvex",
        "LetterText",
        "LibraryBig",
        "LibrarySquare",
        "Library",
        "LifeBuoy",
        "Ligature",
        "LightbulbOff",
        "Lightbulb",
        "LineChart",
        "LineDotRightHorizontal",
        "LineSquiggle",
        "Link2Off",
        "Link2",
        "Link",
        "Linkedin",
        "ListCheck",
        "ListChecks",
        "ListChevronsDownUp",
        "ListChevronsUpDown",
        "ListCollapse",
        "ListEnd",
        "ListFilterPlus",
        "ListFilter",
        "ListIndentDecrease",
        "ListIndentIncrease",
        "ListMinus",
        "ListMusic",
        "ListOrdered",
        "ListPlus",
        "ListRestart",
        "ListStart",
        "ListTodo",
        "ListTree",
        "ListVideo",
        "ListX",
        "List",
        "Loader2",
        "LoaderCircle",
        "LoaderPinwheel",
        "Loader",
        "LocateFixed",
        "LocateOff",
        "Locate",
        "LocationEdit",
        "LockKeyholeOpen",
        "LockKeyhole",
        "LockOpen",
        "Lock",
        "LogIn",
        "LogOut",
        "Logs",
        "Lollipop",
        "Luggage",
        "MSquare",
        "Magnet",
        "MailCheck",
        "MailMinus",
        "MailOpen",
        "MailPlus",
        "MailQuestionMark",
        "MailQuestion",
        "MailSearch",
        "MailWarning",
        "MailX",
        "Mail",
        "Mailbox",
        "Mails",
        "MapMinus",
        "MapPinCheckInside",
        "MapPinCheck",
        "MapPinHouse",
        "MapPinMinusInside",
        "MapPinMinus",
        "MapPinOff",
        "MapPinPen",
        "MapPinPlusInside",
        "MapPinPlus",
        "MapPinXInside",
        "MapPinX",
        "MapPin",
        "MapPinned",
        "MapPlus",
        "Map",
        "MarsStroke",
        "Mars",
        "Martini",
        "Maximize2",
        "Maximize",
        "Medal",
        "MegaphoneOff",
        "Megaphone",
        "Meh",
        "MemoryStick",
        "MenuSquare",
        "Menu",
        "Merge",
        "MessageCircleCheck",
        "MessageCircleCode",
        "MessageCircleDashed",
        "MessageCircleHeart",
        "MessageCircleMore",
        "MessageCircleOff",
        "MessageCirclePlus",
        "MessageCircleQuestionMark",
        "MessageCircleQuestion",
        "MessageCircleReply",
        "MessageCircleWarning",
        "MessageCircleX",
        "MessageCircle",
        "MessageSquareCheck",
        "MessageSquareCode",
        "MessageSquareDashed",
        "MessageSquareDiff",
        "MessageSquareDot",
        "MessageSquareHeart",
        "MessageSquareLock",
        "MessageSquareMore",
        "MessageSquareOff",
        "MessageSquarePlus",
        "MessageSquareQuote",
        "MessageSquareReply",
        "MessageSquareShare",
        "MessageSquareText",
        "MessageSquareWarning",
        "MessageSquareX",
        "MessageSquare",
        "MessagesSquare",
        "Metronome",
        "Mic2",
        "MicOff",
        "MicVocal",
        "Mic",
        "Microchip",
        "Microscope",
        "Microwave",
        "Milestone",
        "MilkOff",
        "Milk",
        "Minimize2",
        "Minimize",
        "MinusCircle",
        "MinusSquare",
        "Minus",
        "MirrorRectangular",
        "MirrorRound",
        "MonitorCheck",
        "MonitorCloud",
        "MonitorCog",
        "MonitorDot",
        "MonitorDown",
        "MonitorOff",
        "MonitorPause",
        "MonitorPlay",
        "MonitorSmartphone",
        "MonitorSpeaker",
        "MonitorStop",
        "MonitorUp",
        "MonitorX",
        "Monitor",
        "MoonStar",
        "Moon",
        "MoreHorizontal",
        "MoreVertical",
        "Motorbike",
        "MountainSnow",
        "Mountain",
        "MouseLeft",
        "MouseOff",
        "MousePointer2Off",
        "MousePointer2",
        "MousePointerBan",
        "MousePointerClick",
        "MousePointerSquareDashed",
        "MousePointer",
        "MouseRight",
        "Mouse",
        "Move3D",
        "Move3d",
        "MoveDiagonal2",
        "MoveDiagonal",
        "MoveDownLeft",
        "MoveDownRight",
        "MoveDown",
        "MoveHorizontal",
        "MoveLeft",
        "MoveRight",
        "MoveUpLeft",
        "MoveUpRight",
        "MoveUp",
        "MoveVertical",
        "Move",
        "Music2",
        "Music3",
        "Music4",
        "Music",
        "Navigation2Off",
        "Navigation2",
        "NavigationOff",
        "Navigation",
        "Network",
        "Newspaper",
        "Nfc",
        "NonBinary",
        "NotebookPen",
        "NotebookTabs",
        "NotebookText",
        "Notebook",
        "NotepadTextDashed",
        "NotepadText",
        "NutOff",
        "Nut",
        "OctagonAlert",
        "OctagonMinus",
        "OctagonPause",
        "OctagonX",
        "Octagon",
        "Omega",
        "Option",
        "Orbit",
        "Origami",
        "Outdent",
        "Package2",
        "PackageCheck",
        "PackageMinus",
        "PackageOpen",
        "PackagePlus",
        "PackageSearch",
        "PackageX",
        "Package",
        "PaintBucket",
        "PaintRoller",
        "Paintbrush2",
        "PaintbrushVertical",
        "Paintbrush",
        "Palette",
        "Palmtree",
        "Panda",
        "PanelBottomClose",
        "PanelBottomDashed",
        "PanelBottomInactive",
        "PanelBottomOpen",
        "PanelBottom",
        "PanelLeftClose",
        "PanelLeftDashed",
        "PanelLeftInactive",
        "PanelLeftOpen",
        "PanelLeftRightDashed",
        "PanelLeft",
        "PanelRightClose",
        "PanelRightDashed",
        "PanelRightInactive",
        "PanelRightOpen",
        "PanelRight",
        "PanelTopBottomDashed",
        "PanelTopClose",
        "PanelTopDashed",
        "PanelTopInactive",
        "PanelTopOpen",
        "PanelTop",
        "PanelsLeftBottom",
        "PanelsLeftRight",
        "PanelsRightBottom",
        "PanelsTopBottom",
        "PanelsTopLeft",
        "Paperclip",
        "Parentheses",
        "ParkingCircleOff",
        "ParkingCircle",
        "ParkingMeter",
        "ParkingSquareOff",
        "ParkingSquare",
        "PartyPopper",
        "PauseCircle",
        "PauseOctagon",
        "Pause",
        "PawPrint",
        "PcCase",
        "PenBox",
        "PenLine",
        "PenOff",
        "PenSquare",
        "PenTool",
        "Pen",
        "PencilLine",
        "PencilOff",
        "PencilRuler",
        "Pencil",
        "Pentagon",
        "PercentCircle",
        "PercentDiamond",
        "PercentSquare",
        "Percent",
        "PersonStanding",
        "PhilippinePeso",
        "PhoneCall",
        "PhoneForwarded",
        "PhoneIncoming",
        "PhoneMissed",
        "PhoneOff",
        "PhoneOutgoing",
        "Phone",
        "PiSquare",
        "Pi",
        "Piano",
        "Pickaxe",
        "PictureInPicture2",
        "PictureInPicture",
        "PieChart",
        "PiggyBank",
        "PilcrowLeft",
        "PilcrowRight",
        "PilcrowSquare",
        "Pilcrow",
        "PillBottle",
        "Pill",
        "PinOff",
        "Pin",
        "Pipette",
        "Pizza",
        "PlaneLanding",
        "PlaneTakeoff",
        "Plane",
        "PlayCircle",
        "PlaySquare",
        "Play",
        "Plug2",
        "PlugZap2",
        "PlugZap",
        "Plug",
        "PlusCircle",
        "PlusSquare",
        "Plus",
        "PocketKnife",
        "Pocket",
        "Podcast",
        "PointerOff",
        "Pointer",
        "Popcorn",
        "Popsicle",
        "PoundSterling",
        "PowerCircle",
        "PowerOff",
        "PowerSquare",
        "Power",
        "Presentation",
        "PrinterCheck",
        "PrinterX",
        "Printer",
        "Projector",
        "Proportions",
        "Puzzle",
        "Pyramid",
        "QrCode",
        "Quote",
        "Rabbit",
        "Radar",
        "Radiation",
        "Radical",
        "RadioReceiver",
        "RadioTower",
        "Radio",
        "Radius",
        "RailSymbol",
        "Rainbow",
        "Rat",
        "Ratio",
        "ReceiptCent",
        "ReceiptEuro",
        "ReceiptIndianRupee",
        "ReceiptJapaneseYen",
        "ReceiptPoundSterling",
        "ReceiptRussianRuble",
        "ReceiptSwissFranc",
        "ReceiptText",
        "ReceiptTurkishLira",
        "Receipt",
        "RectangleCircle",
        "RectangleEllipsis",
        "RectangleGoggles",
        "RectangleHorizontal",
        "RectangleVertical",
        "Recycle",
        "Redo2",
        "RedoDot",
        "Redo",
        "RefreshCcwDot",
        "RefreshCcw",
        "RefreshCwOff",
        "RefreshCw",
        "Refrigerator",
        "Regex",
        "RemoveFormatting",
        "Repeat1",
        "Repeat2",
        "Repeat",
        "ReplaceAll",
        "Replace",
        "ReplyAll",
        "Reply",
        "Rewind",
        "Ribbon",
        "Rocket",
        "RockingChair",
        "RollerCoaster",
        "Rose",
        "Rotate3D",
        "Rotate3d",
        "RotateCcwKey",
        "RotateCcwSquare",
        "RotateCcw",
        "RotateCwSquare",
        "RotateCw",
        "RouteOff",
        "Route",
        "Router",
        "Rows2",
        "Rows3",
        "Rows4",
        "Rows",
        "Rss",
        "RulerDimensionLine",
        "Ruler",
        "RussianRuble",
        "Sailboat",
        "Salad",
        "Sandwich",
        "SatelliteDish",
        "Satellite",
        "SaudiRiyal",
        "SaveAll",
        "SaveOff",
        "Save",
        "Scale3D",
        "Scale3d",
        "Scale",
        "Scaling",
        "ScanBarcode",
        "ScanEye",
        "ScanFace",
        "ScanHeart",
        "ScanLine",
        "ScanQrCode",
        "ScanSearch",
        "ScanText",
        "Scan",
        "ScatterChart",
        "School2",
        "School",
        "ScissorsLineDashed",
        "ScissorsSquareDashedBottom",
        "ScissorsSquare",
        "Scissors",
        "Scooter",
        "ScreenShareOff",
        "ScreenShare",
        "ScrollText",
        "Scroll",
        "SearchAlert",
        "SearchCheck",
        "SearchCode",
        "SearchSlash",
        "SearchX",
        "Search",
        "Section",
        "SendHorizonal",
        "SendHorizontal",
        "SendToBack",
        "Send",
        "SeparatorHorizontal",
        "SeparatorVertical",
        "ServerCog",
        "ServerCrash",
        "ServerOff",
        "Server",
        "Settings2",
        "Settings",
        "Shapes",
        "Share2",
        "Share",
        "Sheet",
        "Shell",
        "ShelvingUnit",
        "ShieldAlert",
        "ShieldBan",
        "ShieldCheck",
        "ShieldClose",
        "ShieldEllipsis",
        "ShieldHalf",
        "ShieldMinus",
        "ShieldOff",
        "ShieldPlus",
        "ShieldQuestionMark",
        "ShieldQuestion",
        "ShieldUser",
        "ShieldX",
        "Shield",
        "ShipWheel",
        "Ship",
        "Shirt",
        "ShoppingBag",
        "ShoppingBasket",
        "ShoppingCart",
        "Shovel",
        "ShowerHead",
        "Shredder",
        "Shrimp",
        "Shrink",
        "Shrub",
        "Shuffle",
        "SidebarClose",
        "SidebarOpen",
        "Sidebar",
        "SigmaSquare",
        "Sigma",
        "SignalHigh",
        "SignalLow",
        "SignalMedium",
        "SignalZero",
        "Signal",
        "Signature",
        "SignpostBig",
        "Signpost",
        "Siren",
        "SkipBack",
        "SkipForward",
        "Skull",
        "Slack",
        "SlashSquare",
        "Slash",
        "Slice",
        "SlidersHorizontal",
        "SlidersVertical",
        "Sliders",
        "SmartphoneCharging",
        "SmartphoneNfc",
        "Smartphone",
        "SmilePlus",
        "Smile",
        "Snail",
        "Snowflake",
        "SoapDispenserDroplet",
        "Sofa",
        "SolarPanel",
        "SortAsc",
        "SortDesc",
        "Soup",
        "Space",
        "Spade",
        "Sparkle",
        "Sparkles",
        "Speaker",
        "Speech",
        "SpellCheck2",
        "SpellCheck",
        "SplinePointer",
        "Spline",
        "SplitSquareHorizontal",
        "SplitSquareVertical",
        "Split",
        "Spool",
        "Spotlight",
        "SprayCan",
        "Sprout",
        "SquareActivity",
        "SquareArrowDownLeft",
        "SquareArrowDownRight",
        "SquareArrowDown",
        "SquareArrowLeft",
        "SquareArrowOutDownLeft",
        "SquareArrowOutDownRight",
        "SquareArrowOutUpLeft",
        "SquareArrowOutUpRight",
        "SquareArrowRightEnter",
        "SquareArrowRightExit",
        "SquareArrowRight",
        "SquareArrowUpLeft",
        "SquareArrowUpRight",
        "SquareArrowUp",
        "SquareAsterisk",
        "SquareBottomDashedScissors",
        "SquareCenterlineDashedHorizontal",
        "SquareCenterlineDashedVertical",
        "SquareChartGantt",
        "SquareCheckBig",
        "SquareCheck",
        "SquareChevronDown",
        "SquareChevronLeft",
        "SquareChevronRight",
        "SquareChevronUp",
        "SquareCode",
        "SquareDashedBottomCode",
        "SquareDashedBottom",
        "SquareDashedKanban",
        "SquareDashedMousePointer",
        "SquareDashedTopSolid",
        "SquareDashed",
        "SquareDivide",
        "SquareDot",
        "SquareEqual",
        "SquareFunction",
        "SquareGanttChart",
        "SquareKanban",
        "SquareLibrary",
        "SquareM",
        "SquareMenu",
        "SquareMinus",
        "SquareMousePointer",
        "SquareParkingOff",
        "SquareParking",
        "SquarePause",
        "SquarePen",
        "SquarePercent",
        "SquarePi",
        "SquarePilcrow",
        "SquarePlay",
        "SquarePlus",
        "SquarePower",
        "SquareRadical",
        "SquareRoundCorner",
        "SquareScissors",
        "SquareSigma",
        "SquareSlash",
        "SquareSplitHorizontal",
        "SquareSplitVertical",
        "SquareSquare",
        "SquareStack",
        "SquareStar",
        "SquareStop",
        "SquareTerminal",
        "SquareUserRound",
        "SquareUser",
        "SquareX",
        "Square",
        "SquaresExclude",
        "SquaresIntersect",
        "SquaresSubtract",
        "SquaresUnite",
        "SquircleDashed",
        "Squircle",
        "Squirrel",
        "Stamp",
        "StarHalf",
        "StarOff",
        "Star",
        "Stars",
        "StepBack",
        "StepForward",
        "Stethoscope",
        "Sticker",
        "StickyNote",
        "Stone",
        "StopCircle",
        "Store",
        "StretchHorizontal",
        "StretchVertical",
        "Strikethrough",
        "Subscript",
        "Subtitles",
        "SunDim",
        "SunMedium",
        "SunMoon",
        "SunSnow",
        "Sun",
        "Sunrise",
        "Sunset",
        "Superscript",
        "SwatchBook",
        "SwissFranc",
        "SwitchCamera",
        "Sword",
        "Swords",
        "Syringe",
        "Table2",
        "TableCellsMerge",
        "TableCellsSplit",
        "TableColumnsSplit",
        "TableConfig",
        "TableOfContents",
        "TableProperties",
        "TableRowsSplit",
        "Table",
        "TabletSmartphone",
        "Tablet",
        "Tablets",
        "Tag",
        "Tags",
        "Tally1",
        "Tally2",
        "Tally3",
        "Tally4",
        "Tally5",
        "Tangent",
        "Target",
        "Telescope",
        "TentTree",
        "Tent",
        "TerminalSquare",
        "Terminal",
        "TestTube2",
        "TestTubeDiagonal",
        "TestTube",
        "TestTubes",
        "TextAlignCenter",
        "TextAlignEnd",
        "TextAlignJustify",
        "TextAlignStart",
        "TextCursorInput",
        "TextCursor",
        "TextInitial",
        "TextQuote",
        "TextSearch",
        "TextSelect",
        "TextSelection",
        "TextWrap",
        "Text",
        "Theater",
        "ThermometerSnowflake",
        "ThermometerSun",
        "Thermometer",
        "ThumbsDown",
        "ThumbsUp",
        "TicketCheck",
        "TicketMinus",
        "TicketPercent",
        "TicketPlus",
        "TicketSlash",
        "TicketX",
        "Ticket",
        "TicketsPlane",
        "Tickets",
        "TimerOff",
        "TimerReset",
        "Timer",
        "ToggleLeft",
        "ToggleRight",
        "Toilet",
        "ToolCase",
        "Toolbox",
        "Tornado",
        "Torus",
        "TouchpadOff",
        "Touchpad",
        "TowelRack",
        "TowerControl",
        "ToyBrick",
        "Tractor",
        "TrafficCone",
        "TrainFrontTunnel",
        "TrainFront",
        "TrainTrack",
        "Train",
        "TramFront",
        "Transgender",
        "Trash2",
        "Trash",
        "TreeDeciduous",
        "TreePalm",
        "TreePine",
        "Trees",
        "Trello",
        "TrendingDown",
        "TrendingUpDown",
        "TrendingUp",
        "TriangleAlert",
        "TriangleDashed",
        "TriangleRight",
        "Triangle",
        "Trophy",
        "TruckElectric",
        "Truck",
        "TurkishLira",
        "Turntable",
        "Turtle",
        "Tv2",
        "TvMinimalPlay",
        "TvMinimal",
        "Tv",
        "Twitch",
        "Twitter",
        "TypeOutline",
        "Type",
        "UmbrellaOff",
        "Umbrella",
        "Underline",
        "Undo2",
        "UndoDot",
        "Undo",
        "UnfoldHorizontal",
        "UnfoldVertical",
        "Ungroup",
        "University",
        "Unlink2",
        "Unlink",
        "UnlockKeyhole",
        "Unlock",
        "Unplug",
        "UploadCloud",
        "Upload",
        "Usb",
        "User2",
        "UserCheck2",
        "UserCheck",
        "UserCircle2",
        "UserCircle",
        "UserCog2",
        "UserCog",
        "UserKey",
        "UserLock",
        "UserMinus2",
        "UserMinus",
        "UserPen",
        "UserPlus2",
        "UserPlus",
        "UserRoundCheck",
        "UserRoundCog",
        "UserRoundKey",
        "UserRoundMinus",
        "UserRoundPen",
        "UserRoundPlus",
        "UserRoundSearch",
        "UserRoundX",
        "UserRound",
        "UserSearch",
        "UserSquare2",
        "UserSquare",
        "UserStar",
        "UserX2",
        "UserX",
        "User",
        "Users2",
        "UsersRound",
        "Users",
        "UtensilsCrossed",
        "Utensils",
        "UtilityPole",
        "Van",
        "Variable",
        "Vault",
        "VectorSquare",
        "Vegan",
        "VenetianMask",
        "VenusAndMars",
        "Venus",
        "Verified",
        "VibrateOff",
        "Vibrate",
        "VideoOff",
        "Video",
        "Videotape",
        "View",
        "Voicemail",
        "Volleyball",
        "Volume1",
        "Volume2",
        "VolumeOff",
        "VolumeX",
        "Volume",
        "Vote",
        "Wallet2",
        "WalletCards",
        "WalletMinimal",
        "Wallet",
        "Wallpaper",
        "Wand2",
        "WandSparkles",
        "Wand",
        "Warehouse",
        "WashingMachine",
        "Watch",
        "WavesArrowDown",
        "WavesArrowUp",
        "WavesLadder",
        "Waves",
        "Waypoints",
        "Webcam",
        "WebhookOff",
        "Webhook",
        "WeightTilde",
        "Weight",
        "WheatOff",
        "Wheat",
        "WholeWord",
        "WifiCog",
        "WifiHigh",
        "WifiLow",
        "WifiOff",
        "WifiPen",
        "WifiSync",
        "WifiZero",
        "Wifi",
        "WindArrowDown",
        "Wind",
        "WineOff",
        "Wine",
        "Workflow",
        "Worm",
        "WrapText",
        "Wrench",
        "XCircle",
        "XLineTop",
        "XOctagon",
        "XSquare",
        "X",
        "Youtube",
        "ZapOff",
        "Zap",
        "ZoomIn",
        "ZoomOut",
        "brush.round",
        "brush.soft",
        "brush.square",
        "brush.flat",
        "brush.angle",
        "brush.filbert",
        "brush.rake",
        "brush.fan",
        "brush.dry",
        "brush.spray",
        "brush.knife",
        "tool.brush",
        "tool.eraser",
        "tool.line",
        "tool.rect",
        "tool.ellipse",
        "tool.fill",
        "tool.eyedropper",
        "tool.smudge",
        "tool.blur",
        "tool.text",
        "tool.marquee",
        "tool.lasso",
        "tool.pen",
        "cat.floor",
        "cat.wall",
        "cat.ramp",
        "cat.roof",
        "cat.stairs",
        "cat.elevator",
        "cat.pillar",
        "cat.prefabs",
        "cat.water",
        "cat.tower"
      ]);
    }
  });

  // runtime/icons/Icon.tsx
  function pointLineDistance(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  function simplifyPointRange(points, start, end, keep) {
    if (end <= start + 1) return;
    const ax = points[start][0];
    const ay = points[start][1];
    const bx = points[end][0];
    const by = points[end][1];
    let maxDistance = 0;
    let split = start;
    for (let i = start + 1; i < end; i++) {
      const distance = pointLineDistance(points[i][0], points[i][1], ax, ay, bx, by);
      if (distance > maxDistance) {
        maxDistance = distance;
        split = i;
      }
    }
    if (maxDistance > SIMPLIFY_EPSILON) {
      keep[split] = true;
      simplifyPointRange(points, start, split, keep);
      simplifyPointRange(points, split, end, keep);
    }
  }
  function simplifyPolyline(poly) {
    if (poly.length <= 8) return poly;
    const points = [];
    for (let i = 0; i + 1 < poly.length; i += 2) {
      points.push([poly[i], poly[i + 1]]);
    }
    if (points.length <= 2) return poly;
    const keep = new Array(points.length).fill(false);
    keep[0] = true;
    keep[points.length - 1] = true;
    simplifyPointRange(points, 0, points.length - 1, keep);
    const out = [];
    for (let i = 0; i < points.length; i++) {
      if (keep[i]) out.push(points[i][0], points[i][1]);
    }
    return out.length >= 4 ? out : poly;
  }
  function simplifyIconData(paths) {
    return paths.map(simplifyPolyline);
  }
  function resolvePaths(name, icon) {
    if (icon) {
      const cached2 = directPathCache.get(icon);
      if (cached2) return cached2;
      const simplified2 = simplifyIconData(icon);
      directPathCache.set(icon, simplified2);
      return simplified2;
    }
    if (!name) return void 0;
    const cached = namedPathCache.get(name);
    if (cached) return cached;
    const paths = lookupIcon(name);
    if (!paths) return void 0;
    const simplified = simplifyIconData(paths);
    namedPathCache.set(name, simplified);
    return simplified;
  }
  function polylineToD(poly) {
    if (poly.length < 4) return "";
    let out = `M ${poly[0] - HALF},${poly[1] - HALF}`;
    for (let i = 2; i < poly.length; i += 2) {
      out += ` L ${poly[i] - HALF},${poly[i + 1] - HALF}`;
    }
    return out;
  }
  function renderPaths(paths, color, strokeWidth) {
    return paths.map((poly, index) => /* @__PURE__ */ React.createElement(
      Graph.Path,
      {
        key: index,
        d: polylineToD(poly),
        stroke: color,
        strokeWidth,
        fill: "none"
      }
    ));
  }
  function toBakedKey(name) {
    return name.replace(/(^|[-_])([a-z0-9])/g, (_, __, c) => c.toUpperCase()).replace(/[-_]/g, "");
  }
  function Icon(props) {
    const size = props.size ?? 16;
    const color = props.color ?? "theme:ink";
    const strokeWidth = props.strokeWidth ?? 2;
    if (props.name && !props.icon) {
      const key = toBakedKey(props.name);
      if (BAKED_ICON_NAMES.has(key)) {
        return /* @__PURE__ */ React.createElement(SdfIcon, { name: key, size, color });
      }
    }
    const paths = resolvePaths(props.name, props.icon);
    if (!paths || paths.length === 0) {
      return /* @__PURE__ */ React.createElement(Box, { style: { width: size, height: size } });
    }
    return /* @__PURE__ */ React.createElement(Box, { style: { width: size, height: size, overflow: "hidden" } }, /* @__PURE__ */ React.createElement(
      Graph,
      {
        style: { width: size, height: size },
        viewX: 0,
        viewY: 0,
        viewZoom: size / VIEW
      },
      renderPaths(paths, color, strokeWidth)
    ));
  }
  var VIEW, HALF, SIMPLIFY_EPSILON, namedPathCache, directPathCache;
  var init_Icon = __esm({
    "runtime/icons/Icon.tsx"() {
      init_primitives();
      init_registry();
      init_baked_names();
      VIEW = 24;
      HALF = 12;
      SIMPLIFY_EPSILON = 0.35;
      namedPathCache = /* @__PURE__ */ new Map();
      directPathCache = /* @__PURE__ */ new WeakMap();
    }
  });

  // runtime/classifier.tsx
  var classifier_exports = {};
  __export(classifier_exports, {
    ThemeProvider: () => ThemeProvider,
    __useClassifierSnapshot: () => __useClassifierSnapshot,
    applyPreset: () => applyPreset,
    breakpointAtLeast: () => breakpointAtLeast,
    classifier: () => classifier,
    classifierNames: () => classifierNames,
    classifiers: () => classifiers,
    findTheme: () => findTheme,
    getBreakpoint: () => getBreakpoint,
    getClassifier: () => getClassifier,
    getColors: () => getColors,
    getDim: () => getDim,
    getDims: () => getDims,
    getStylePalette: () => getStylePalette,
    getVariant: () => getVariant,
    getViewportWidth: () => getViewportWidth,
    hasTokens: () => hasTokens,
    isThemeToken: () => isThemeToken,
    resolveToken: () => resolveToken,
    resolveTokens: () => resolveTokens,
    setBreakpointThresholds: () => setBreakpointThresholds,
    setDim: () => setDim,
    setPalette: () => setPalette,
    setStylePalette: () => setStylePalette,
    setStyleTokens: () => setStyleTokens,
    setTokens: () => setTokens,
    setVariant: () => setVariant,
    setViewportWidth: () => setViewportWidth,
    themes: () => themes,
    useActiveDim: () => useActiveDim,
    useActiveVariant: () => useActiveVariant,
    useBreakpoint: () => useBreakpoint,
    useStylePalette: () => useStylePalette,
    useThemeColors: () => useThemeColors,
    useThemeColorsOptional: () => useThemeColorsOptional,
    useThemeStore: () => useThemeStore,
    useViewportWidth: () => useViewportWidth
  });
  function bpFromWidth(w, md, lg, xl) {
    if (w >= xl) return "xl";
    if (w >= lg) return "lg";
    if (w >= md) return "md";
    return "sm";
  }
  function notify() {
    for (const l of listeners) l();
  }
  function subscribe(fn) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }
  function snapshot() {
    return store;
  }
  function setPalette(colors) {
    store = { ...store, colors };
    notify();
  }
  function setTokens(partial) {
    store = { ...store, colors: { ...store.colors, ...partial } };
    notify();
  }
  function setStylePalette(styles) {
    store = { ...store, styles };
    notify();
  }
  function setStyleTokens(partial) {
    store = { ...store, styles: { ...store.styles, ...partial } };
    notify();
  }
  function setVariant(variant) {
    if (store.variant === variant) return;
    store = { ...store, variant };
    notify();
  }
  function setDim(name, value) {
    if ((store.dims[name] ?? null) === value) return;
    const nextDims = { ...store.dims, [name]: value };
    if (value === null) delete nextDims[name];
    store = { ...store, dims: nextDims };
    notify();
  }
  function getDim(name) {
    return store.dims[name] ?? null;
  }
  function getDims() {
    return { ...store.dims };
  }
  function applyPreset(preset) {
    store = {
      ...store,
      colors: preset.colors,
      styles: preset.styles,
      variant: preset.variant ?? store.variant
    };
    notify();
  }
  function setViewportWidth(width) {
    const bp = bpFromWidth(width, store.thresholdMd, store.thresholdLg, store.thresholdXl);
    if (width === store.viewportWidth && bp === store.breakpoint) return;
    store = { ...store, viewportWidth: width, breakpoint: bp };
    notify();
  }
  function setBreakpointThresholds(md, lg, xl) {
    const bp = bpFromWidth(store.viewportWidth, md, lg, xl);
    store = { ...store, thresholdMd: md, thresholdLg: lg, thresholdXl: xl, breakpoint: bp };
    notify();
  }
  function getColors() {
    return store.colors;
  }
  function getStylePalette() {
    return store.styles;
  }
  function getVariant() {
    return store.variant;
  }
  function getBreakpoint() {
    return store.breakpoint;
  }
  function getViewportWidth() {
    return store.viewportWidth;
  }
  function breakpointAtLeast(bp) {
    return BP_ORDER.indexOf(store.breakpoint) >= BP_ORDER.indexOf(bp);
  }
  function isThemeToken(v) {
    return typeof v === "string" && v.startsWith(THEME_PREFIX2);
  }
  function resolveToken(token, colors, styles) {
    const name = token.slice(THEME_PREFIX2.length);
    if (name in colors) return colors[name];
    if (name in styles) return styles[name];
    return token;
  }
  function resolveTokens(obj, colors, styles) {
    const out = {};
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (isThemeToken(v)) {
        out[k] = resolveToken(v, colors, styles);
      } else if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Function)) {
        out[k] = resolveTokens(v, colors, styles);
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  function hasTokens(obj) {
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (isThemeToken(v)) return true;
      if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Function)) {
        if (hasTokens(v)) return true;
      }
    }
    return false;
  }
  function ThemeProvider({ colors, styles, initialVariant, children }) {
    React4.useLayoutEffect(() => {
      if (initialVariant !== void 0) setVariant(initialVariant);
    }, []);
    React4.useLayoutEffect(() => {
      if (colors) setTokens(colors);
    }, [colors]);
    React4.useLayoutEffect(() => {
      if (styles) setStyleTokens(styles);
    }, [styles]);
    const current = useThemeColors();
    return React4.createElement(ThemeContext.Provider, { value: current }, children);
  }
  function useThemeColors() {
    return React4.useSyncExternalStore(subscribe, () => snapshot().colors);
  }
  function useThemeColorsOptional() {
    return useThemeColors();
  }
  function useStylePalette() {
    return React4.useSyncExternalStore(subscribe, () => snapshot().styles);
  }
  function useActiveVariant() {
    return React4.useSyncExternalStore(subscribe, () => snapshot().variant);
  }
  function useActiveDim(name) {
    return React4.useSyncExternalStore(subscribe, () => snapshot().dims[name] ?? null);
  }
  function useBreakpoint() {
    return React4.useSyncExternalStore(subscribe, () => snapshot().breakpoint);
  }
  function useViewportWidth() {
    return React4.useSyncExternalStore(subscribe, () => snapshot().viewportWidth);
  }
  function useThemeStore() {
    return React4.useSyncExternalStore(subscribe, () => {
      const s = snapshot();
      return { colors: s.colors, styles: s.styles, variant: s.variant, breakpoint: s.breakpoint };
    });
  }
  function __useClassifierSnapshot() {
    return React4.useSyncExternalStore(subscribe, snapshot);
  }
  function shallowMergeStyle(...blocks) {
    const present = blocks.filter((b) => !!b && typeof b === "object");
    if (present.length === 0) return void 0;
    if (present.length === 1) return present[0];
    return Object.assign({}, ...present);
  }
  function mergeStyleSets(...sets) {
    const out = {};
    for (const s of sets) {
      if (!s) continue;
      for (const k of Object.keys(s)) {
        if (RESERVED_KEYS.has(k)) continue;
        if (STYLE_KEY_SET.has(k)) {
          out[k] = shallowMergeStyle(out[k], s[k]);
        } else {
          out[k] = s[k];
        }
      }
    }
    return out;
  }
  function mergeUserProps(defaults, user) {
    const merged = { ...defaults, ...user };
    for (const k of STYLE_KEYS) {
      if (defaults[k] && user[k]) {
        merged[k] = { ...defaults[k], ...user[k] };
      }
    }
    return merged;
  }
  function stripReserved(def) {
    const out = {};
    for (const k of Object.keys(def)) {
      if (RESERVED_KEYS.has(k)) continue;
      out[k] = def[k];
    }
    return out;
  }
  function collectTokens(def) {
    if (hasTokens(stripReserved(def))) return true;
    if (def.variants) {
      for (const v of Object.values(def.variants)) {
        if (hasTokens(v)) return true;
      }
    }
    if (def.dims) {
      for (const dim of Object.values(def.dims)) {
        if (!dim) continue;
        for (const v of Object.values(dim)) {
          if (hasTokens(v)) return true;
        }
      }
    }
    if (def.bp) {
      for (const bp of Object.values(def.bp)) {
        if (!bp) continue;
        if (hasTokens(bp)) return true;
      }
    }
    return false;
  }
  function hasAnyVariants(def) {
    if (def.variants && Object.keys(def.variants).length) return true;
    if (def.bp) {
      for (const bp of Object.values(def.bp)) {
        if (bp?.variants && Object.keys(bp.variants).length) return true;
      }
    }
    return false;
  }
  function hasAnyDims(def) {
    if (!def.dims) return false;
    for (const dim of Object.values(def.dims)) {
      if (dim && Object.keys(dim).length) return true;
    }
    return false;
  }
  function hasAnyBreakpoints(def) {
    return !!(def.bp && Object.keys(def.bp).length);
  }
  function resolveEffective(def, variant, bp, dims) {
    const base = stripReserved(def);
    const bpBase = def.bp?.[bp] ? stripReserved(def.bp[bp]) : void 0;
    const varBase = variant && def.variants?.[variant] ? stripReserved(def.variants[variant]) : void 0;
    const bpVar = variant && def.bp?.[bp]?.variants?.[variant] ? stripReserved(def.bp[bp].variants[variant]) : void 0;
    if (!def.dims) {
      return mergeStyleSets(base, bpBase, varBase, bpVar);
    }
    const dimMerges = [];
    for (const dimName of Object.keys(def.dims)) {
      const active = dims[dimName];
      if (!active) continue;
      const styleSet = def.dims[dimName]?.[active];
      if (styleSet) dimMerges.push(stripReserved(styleSet));
    }
    return mergeStyleSets(base, bpBase, varBase, bpVar, ...dimMerges);
  }
  function classifier(defs) {
    const expanded = {};
    for (const name of Object.keys(defs)) {
      const def = defs[name];
      const dotKeys = Object.keys(def).filter((k) => k.startsWith("."));
      if (dotKeys.length === 0) {
        expanded[name] = def;
        continue;
      }
      const parentClean = { type: def.type };
      for (const k of Object.keys(def)) {
        if (k.startsWith(".")) continue;
        parentClean[k] = def[k];
      }
      expanded[name] = parentClean;
      for (const dk of dotKeys) {
        const childRaw = def[dk];
        const childName = name + dk.slice(1);
        const merged = mergeStyleSets(stripReserved(parentClean), childRaw);
        const childDef = {
          type: childRaw.type ?? parentClean.type,
          ...merged
        };
        if (parentClean.variants && !childRaw.variants) childDef.variants = parentClean.variants;
        if (parentClean.bp && !childRaw.bp) childDef.bp = parentClean.bp;
        if (parentClean.use && !childRaw.use) childDef.use = parentClean.use;
        expanded[childName] = childDef;
      }
    }
    for (const name of Object.keys(expanded)) {
      if (_registry[name]) {
        throw new Error(
          `classifier: "${name}" already registered. Classifiers are global \u2014 one name, one definition.`
        );
      }
      const def = expanded[name];
      const Primitive = PRIMITIVES[def.type];
      if (!Primitive) {
        throw new Error(
          `classifier: "${def.type}" is not a primitive. Valid: ${Object.keys(PRIMITIVES).join(", ")}`
        );
      }
      const needsTokens = collectTokens(def);
      const needsVariants = hasAnyVariants(def);
      const needsDims = hasAnyDims(def);
      const needsBp = hasAnyBreakpoints(def);
      const needsHook = typeof def.use === "function";
      const needsStore = needsTokens || needsVariants || needsDims || needsBp;
      const staticBase = stripReserved(def);
      const staticBaseIsEmpty = Object.keys(staticBase).length === 0;
      let C;
      if (!needsStore && !needsHook && staticBaseIsEmpty) {
        C = Primitive;
      } else if (!needsStore && !needsHook) {
        C = (props) => React4.createElement(Primitive, mergeUserProps(staticBase, props));
      } else {
        C = (props) => {
          const snap = needsStore ? __useClassifierSnapshot() : null;
          const resolved = React4.useMemo(() => {
            let effective;
            if (snap && (needsVariants || needsBp || needsDims)) {
              effective = resolveEffective(def, snap.variant, snap.breakpoint, snap.dims);
            } else {
              effective = staticBase;
            }
            if (needsTokens && snap) {
              return resolveTokens(effective, snap.colors, snap.styles);
            }
            return effective;
          }, [
            snap?.colors,
            snap?.styles,
            snap?.variant,
            snap?.breakpoint,
            snap?.dims
          ]);
          const hookProps = needsHook ? def.use() : null;
          const merged = hookProps ? mergeUserProps(resolved, mergeUserProps(hookProps, props)) : mergeUserProps(resolved, props);
          return React4.createElement(Primitive, merged);
        };
      }
      C.displayName = name;
      C.__isClassifier = true;
      C.__def = def;
      _registry[name] = C;
    }
  }
  function getClassifier(name) {
    return _registry[name] ?? null;
  }
  function classifierNames() {
    return Object.keys(_registry);
  }
  var React4, BP_ORDER, store, listeners, THEME_PREFIX2, ThemeContext, PRIMITIVES, STYLE_KEYS, STYLE_KEY_SET, RESERVED_KEYS, _registry, classifiers;
  var init_classifier = __esm({
    "runtime/classifier.tsx"() {
      React4 = __toESM(require_react(), 1);
      init_theme_presets();
      init_primitives();
      init_Icon();
      init_theme_presets();
      BP_ORDER = ["sm", "md", "lg", "xl"];
      store = {
        colors: catppuccin_mocha,
        styles: rounded_airy,
        variant: null,
        dims: {},
        viewportWidth: 1280,
        breakpoint: "lg",
        thresholdMd: 640,
        thresholdLg: 1024,
        thresholdXl: 1440
      };
      listeners = /* @__PURE__ */ new Set();
      THEME_PREFIX2 = "theme:";
      ThemeContext = React4.createContext(null);
      PRIMITIVES = {
        Box,
        Text,
        Image,
        Pressable,
        ScrollView,
        StaticSurface,
        TextInput,
        Canvas,
        CanvasNode: Canvas.Node,
        CanvasPath: Canvas.Path,
        CanvasClamp: Canvas.Clamp,
        Graph,
        GraphNode: Graph.Node,
        GraphPath: Graph.Path,
        Native,
        Icon
      };
      STYLE_KEYS = [
        "style",
        "hoverStyle",
        "activeStyle",
        "focusStyle",
        "textStyle",
        "contentContainerStyle"
      ];
      STYLE_KEY_SET = new Set(STYLE_KEYS);
      RESERVED_KEYS = /* @__PURE__ */ new Set(["type", "use", "variants", "bp", "dims"]);
      _registry = {};
      classifiers = _registry;
    }
  });

  // cart/editor/worldBible/worldBibleStyle.test.ts
  init_classifier();

  // cart/editor/worldBible/worldBible.cls.ts
  init_classifier();

  // cart/editor/shell/regions.ts
  var BORDER = 1;
  var PANEL_GUTTER = 10;
  var CHROME_HEIGHT = 37;
  var ACTION_BAR_HEIGHT = 36;
  var LEFT_RAIL_WIDTH = 48;
  var CONTENT_BROWSER_WIDTH = 350;
  var CONTENT_BROWSER_WIDTH_EXPANDED = 680;
  var CONTENT_BROWSER_TREE_WIDTH = 218;
  var FOCUS_PANEL_WIDTH = 326;
  var FOCUS_PANEL_ATLAS_WIDTH = 480;
  var FOCUS_RAIL_WIDTH = 40;
  var STATUS_BAR_HEIGHT = 31;
  var REGIONS = {
    /** WINDOW CHROME — the top strip. Menu bar, active map, Editor/Play toggle. */
    chrome: { height: CHROME_HEIGHT },
    /** ACTION BAR — the tool row (ToolOptions) pinned under the chrome, above the stage. */
    actionBar: { height: ACTION_BAR_HEIGHT },
    /** LEFT RAIL — contextual input-pane buttons on the window's left edge. */
    leftRail: { width: LEFT_RAIL_WIDTH },
    /**
     * CONTENT BROWSER — the left panel (tree, search, asset grids, model gallery).
     * innerWidth is what content actually gets: outer minus the right border and
     * the standard 10px gutters. Import THIS, don't re-derive it from state.
     */
    contentBrowser: {
      width: CONTENT_BROWSER_WIDTH,
      expandedWidth: CONTENT_BROWSER_WIDTH_EXPANDED,
      treeWidth: CONTENT_BROWSER_TREE_WIDTH,
      gutter: PANEL_GUTTER,
      innerWidth: CONTENT_BROWSER_WIDTH - BORDER - PANEL_GUTTER * 2,
      // 329
      // Expanded grid column's usable width: expanded outer minus the panel's right
      // border, the tree column + its divider, and the standard gutters.
      gridInnerWidth: CONTENT_BROWSER_WIDTH_EXPANDED - BORDER - CONTENT_BROWSER_TREE_WIDTH - BORDER - PANEL_GUTTER * 2
      // 440
    },
    /** VIEWPORT — the center stage. The ONE region that flexes; no fixed number. */
    viewport: { flexes: true },
    /**
     * FOCUS PANEL — the open right body plus its persistent contextual rail.
     * bodyWidth = outer minus its left border and the pane-switch rail;
     * innerWidth = bodyWidth minus the inspector body's 10px gutters — the
     * constant every focus-panel card/section lays out against.
     */
    focusPanel: {
      width: FOCUS_PANEL_WIDTH,
      atlasWidth: FOCUS_PANEL_ATLAS_WIDTH,
      railWidth: FOCUS_RAIL_WIDTH,
      bodyWidth: FOCUS_PANEL_WIDTH - BORDER - FOCUS_RAIL_WIDTH,
      // 285
      atlasBodyWidth: FOCUS_PANEL_ATLAS_WIDTH - BORDER - FOCUS_RAIL_WIDTH,
      gutter: PANEL_GUTTER,
      innerWidth: FOCUS_PANEL_WIDTH - BORDER - FOCUS_RAIL_WIDTH - PANEL_GUTTER * 2,
      // 265
      atlasInnerWidth: FOCUS_PANEL_ATLAS_WIDTH - BORDER - FOCUS_RAIL_WIDTH - PANEL_GUTTER * 2
    },
    /** STATUS BAR — the bottom strip (the build dock: undo/redo, coords, perf). */
    statusBar: { height: STATUS_BAR_HEIGHT },
    /**
     * THE SHARED CONTROL GRID (req_2626 II) — panel rows sit on fixed columns:
     * a fixed label column, values/controls flexing to ONE right edge, fixed
     * stepper/value/reset columns, one baseline per row. Rows RESERVE space
     * ("we are not bartering for UI space"); labels never wrap.
     */
    grid: {
      /** fixed label column for form/read rows (HW_FormLabel). */
      labelWidth: 82,
      /** square − / + stepper button (HW_OvBtn). */
      stepBtn: 20,
      /** numeric value cell between steppers (HW_OvVal). */
      valueWidth: 40,
      /** trailing reset-rider column — ALWAYS reserved, set or not (HW_OvReset/Idle). */
      endBtn: 18,
      /** minimum read-row height, one baseline (HW_ReadRow). */
      rowHeight: 21,
      /** a section's action row: fixed height, verbs on the row (HW_VerbRow). */
      verbRowHeight: 24,
      /** button height inside a verb row (HW_VerbPrimary/HW_VerbFixed). */
      verbHeight: 22,
      /** fixed-width secondary verb column at the right edge (HW_VerbFixed). */
      verbColWidth: 56
    }
  };

  // cart/editor/worldBible/worldBible.cls.ts
  var MONO = "monospace";
  classifier({
    WB_IndexPanel: { type: "Box", style: { width: REGIONS.contentBrowser.width, minWidth: REGIONS.contentBrowser.width, flexDirection: "column", minHeight: 0, backgroundColor: "theme:bgAlt", borderRightWidth: 1, borderRightColor: "theme:border" } },
    WB_IndexHead: { type: "Box", style: { height: 43, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 10, paddingRight: 8, borderBottomWidth: 1, borderBottomColor: "theme:border" } },
    WB_IndexTitle: { type: "Text", fontSize: 11, color: "theme:text", noWrap: true, style: { fontFamily: MONO, fontWeight: 900, letterSpacing: 0.7 } },
    WB_IconButton: { type: "Pressable", style: { width: 26, height: 26, alignItems: "center", justifyContent: "center", borderRadius: 3, backgroundColor: "theme:controlBg", borderWidth: 1, borderColor: "theme:controlBorder" }, hoverStyle: { borderColor: "theme:primary" } },
    WB_SearchWrap: { type: "Box", style: { height: 42, padding: 7, borderBottomWidth: 1, borderBottomColor: "theme:borderSoft" } },
    WB_SearchBox: { type: "Box", style: { flexGrow: 1, flexDirection: "row", alignItems: "center", gap: 7, paddingLeft: 8, paddingRight: 7, backgroundColor: "theme:controlBg", borderWidth: 1, borderColor: "theme:controlBorder", borderRadius: 3 } },
    WB_SearchInput: { type: "TextInput", style: { flexGrow: 1, minWidth: 0, height: 28, color: "theme:text", fontSize: 10, fontFamily: MONO } },
    WB_FilterBar: { type: "Box", style: { minHeight: 55, flexDirection: "row", flexWrap: "wrap", alignContent: "center", gap: 4, padding: 7, borderBottomWidth: 1, borderBottomColor: "theme:borderSoft" } },
    WB_Filter: { type: "Pressable", style: { height: 20, justifyContent: "center", paddingLeft: 7, paddingRight: 7, borderRadius: 2, backgroundColor: "theme:controlBg", borderWidth: 1, borderColor: "theme:borderSoft" }, hoverStyle: { borderColor: "theme:textDim" } },
    WB_FilterOn: { type: "Pressable", style: { height: 20, justifyContent: "center", paddingLeft: 7, paddingRight: 7, borderRadius: 2, backgroundColor: "theme:segActiveBg", borderWidth: 1, borderColor: "theme:primary" } },
    WB_FilterText: { type: "Text", fontSize: 7, color: "theme:textDim", noWrap: true, style: { fontFamily: MONO, fontWeight: 800, letterSpacing: 0.4 } },
    WB_FilterTextOn: { type: "Text", fontSize: 7, color: "theme:segActiveText", noWrap: true, style: { fontFamily: MONO, fontWeight: 900, letterSpacing: 0.4 } },
    WB_PageList: { type: "ScrollView", style: { flexGrow: 1, minHeight: 0 } },
    WB_PageRow: { type: "Pressable", style: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 9, paddingRight: 8, paddingTop: 6, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: "theme:borderSoft" }, hoverStyle: { backgroundColor: "theme:surfaceHover" } },
    WB_PageRowOn: { type: "Pressable", style: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: 6, backgroundColor: "theme:segActiveBg", borderLeftWidth: 2, borderLeftColor: "theme:primary", borderBottomWidth: 1, borderBottomColor: "theme:borderSoft" } },
    WB_KindMark: { type: "Box", style: { width: 8, height: 8, borderRadius: 4, backgroundColor: "theme:primary" } },
    WB_PageCopy: { type: "Box", style: { flexGrow: 1, minWidth: 0, flexDirection: "column", gap: 3 } },
    WB_PageName: { type: "Text", fontSize: 10, color: "theme:text", noWrap: true, numberOfLines: 1, style: { fontWeight: 800 } },
    WB_PageRef: { type: "Text", fontSize: 7, color: "theme:textFaint", noWrap: true, numberOfLines: 1, style: { fontFamily: MONO } },
    WB_StateTiny: { type: "Text", fontSize: 6, noWrap: true, style: { fontFamily: MONO, fontWeight: 900, letterSpacing: 0.3 } },
    WB_IndexFoot: { type: "Box", style: { minHeight: 28, flexDirection: "row", alignItems: "center", gap: 7, paddingLeft: 9, paddingRight: 8, borderTopWidth: 1, borderTopColor: "theme:border" } },
    WB_MicroText: { type: "Text", fontSize: 7, color: "theme:textFaint", noWrap: true, style: { fontFamily: MONO, fontWeight: 700 } },
    WB_Surface: { type: "Box", style: { width: "100%", height: "100%", flexDirection: "column", minWidth: 0, minHeight: 0, backgroundColor: "theme:surface" } },
    WB_SourceBanner: { type: "Box", style: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 14, paddingRight: 12, backgroundColor: "theme:bgAlt", borderBottomWidth: 1, borderBottomColor: "theme:border" } },
    WB_StateBadge: { type: "Box", style: { height: 18, justifyContent: "center", paddingLeft: 7, paddingRight: 7, borderRadius: 2, backgroundColor: "theme:controlBg", borderWidth: 1, borderColor: "theme:controlBorder" } },
    WB_StateText: { type: "Text", fontSize: 7, noWrap: true, style: { fontFamily: MONO, fontWeight: 900, letterSpacing: 0.6 } },
    WB_BannerText: { type: "Text", fontSize: 8, color: "theme:textDim", noWrap: true, numberOfLines: 1, style: { flexGrow: 1, minWidth: 0, fontFamily: MONO } },
    WB_DiscardConfirm: { type: "Box", style: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 9, paddingLeft: 14, paddingRight: 12, paddingTop: 8, paddingBottom: 8, backgroundColor: "theme:controlBg", borderBottomWidth: 1, borderBottomColor: "theme:error" } },
    WB_DiscardCopy: { type: "Box", style: { flexGrow: 1, minWidth: 0, flexDirection: "column", gap: 4 } },
    WB_DiagnosticPanel: { type: "Box", style: { minHeight: 62, maxHeight: 150, flexDirection: "column", backgroundColor: "theme:bgAlt", borderBottomWidth: 1, borderBottomColor: "theme:warning" } },
    WB_DiagnosticHead: { type: "Box", style: { minHeight: 30, flexDirection: "row", alignItems: "center", gap: 7, paddingLeft: 14, paddingRight: 12, borderBottomWidth: 1, borderBottomColor: "theme:borderSoft" } },
    WB_DiagnosticList: { type: "ScrollView", style: { flexGrow: 1, minHeight: 0 }, contentContainerStyle: { flexDirection: "column" } },
    WB_DiagnosticRow: { type: "Box", style: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 9, paddingLeft: 11, paddingRight: 12, paddingTop: 7, paddingBottom: 7, borderLeftWidth: 3, borderLeftColor: "theme:warning", borderBottomWidth: 1, borderBottomColor: "theme:borderSoft" } },
    WB_DiagnosticCopy: { type: "Box", style: { flexGrow: 1, minWidth: 0, flexDirection: "column", gap: 3 } },
    WB_PageHead: { type: "Box", style: { minHeight: 80, flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 22, paddingRight: 18, paddingTop: 12, paddingBottom: 12, backgroundColor: "theme:bgElevated", borderBottomWidth: 1, borderBottomColor: "theme:border" } },
    WB_HeadCopy: { type: "Box", style: { flexGrow: 1, minWidth: 0, flexDirection: "column", gap: 5 } },
    WB_Kicker: { type: "Text", fontSize: 7, color: "theme:primary", noWrap: true, style: { fontFamily: MONO, fontWeight: 900, letterSpacing: 1.1 } },
    WB_Title: { type: "Text", fontSize: 23, color: "theme:text", noWrap: true, numberOfLines: 1, style: { fontWeight: 900 } },
    WB_Subtitle: { type: "Text", fontSize: 8, color: "theme:textDim", noWrap: true, numberOfLines: 1, style: { fontFamily: MONO } },
    WB_ActionRow: { type: "Box", style: { flexDirection: "row", alignItems: "center", gap: 6 } },
    WB_Action: { type: "Pressable", style: { height: 27, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingLeft: 9, paddingRight: 9, borderRadius: 3, backgroundColor: "theme:controlBg", borderWidth: 1, borderColor: "theme:controlBorder" }, hoverStyle: { borderColor: "theme:primary" } },
    WB_ActionOn: { type: "Pressable", style: { height: 27, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingLeft: 9, paddingRight: 9, borderRadius: 3, backgroundColor: "theme:segActiveBg", borderWidth: 1, borderColor: "theme:primary" } },
    WB_ActionDanger: { type: "Pressable", style: { height: 27, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingLeft: 9, paddingRight: 9, borderRadius: 3, backgroundColor: "theme:controlBg", borderWidth: 1, borderColor: "theme:error" }, hoverStyle: { backgroundColor: "theme:surfaceHover" } },
    WB_ActionText: { type: "Text", fontSize: 7, color: "theme:textSecondary", noWrap: true, style: { fontFamily: MONO, fontWeight: 900, letterSpacing: 0.4 } },
    WB_Content: { type: "Box", style: { flexGrow: 1, minHeight: 0, flexDirection: "row" } },
    WB_ArticleScroll: { type: "ScrollView", style: { flexGrow: 1, minWidth: 0, minHeight: 0 } },
    WB_Article: { type: "Box", style: { flexDirection: "column", gap: 16, paddingLeft: 28, paddingRight: 28, paddingTop: 24, paddingBottom: 40 } },
    WB_Section: { type: "Box", style: { flexDirection: "column", gap: 8 } },
    WB_SectionHead: { type: "Text", fontSize: 13, color: "theme:text", style: { fontWeight: 900 } },
    WB_Paragraph: { type: "Text", fontSize: 11, color: "theme:textSecondary", style: { lineHeight: 18 } },
    WB_LinkLine: { type: "Box", style: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" } },
    WB_Link: { type: "Pressable", style: { minHeight: 18, justifyContent: "center", paddingLeft: 2, paddingRight: 2 } },
    WB_LinkText: { type: "Text", fontSize: 11, color: "theme:primary", style: { fontWeight: 800, lineHeight: 18 } },
    WB_AuthorMarkdown: { type: "Box", style: { flexDirection: "column", gap: 7, padding: 12, borderRadius: 4, backgroundColor: "theme:controlBg", borderWidth: 1, borderColor: "theme:warning" } },
    WB_Notes: { type: "Box", style: { flexDirection: "column", gap: 7, padding: 12, borderRadius: 4, backgroundColor: "theme:controlBg", borderWidth: 1, borderColor: "theme:info" } },
    WB_PublicPreview: { type: "Box", style: { flexDirection: "column", gap: 7, padding: 12, borderRadius: 4, backgroundColor: "theme:controlBg", borderWidth: 1, borderColor: "theme:success" } },
    WB_PublicPreviewFact: { type: "Box", style: { minHeight: 30, flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 5, paddingBottom: 5, borderTopWidth: 1, borderTopColor: "theme:borderSoft" } },
    WB_Aside: { type: "ScrollView", style: { width: 300, minWidth: 300, minHeight: 0, backgroundColor: "theme:bgAlt", borderLeftWidth: 1, borderLeftColor: "theme:border" }, contentContainerStyle: { flexDirection: "column", padding: 14, gap: 10, paddingBottom: 28 } },
    WB_Logo: { type: "Box", style: { height: 128, alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 4, backgroundColor: "theme:controlBg", borderWidth: 1, borderColor: "theme:border" } },
    WB_Monogram: { type: "Box", style: { width: 68, height: 68, alignItems: "center", justifyContent: "center", borderRadius: 34, backgroundColor: "theme:onTrack", borderWidth: 2, borderColor: "theme:accent" } },
    WB_MonogramText: { type: "Text", fontSize: 18, color: "theme:accent", noWrap: true, style: { fontFamily: MONO, fontWeight: 900 } },
    WB_Infobox: { type: "Box", style: { flexDirection: "column", borderRadius: 4, backgroundColor: "theme:controlBg", borderWidth: 1, borderColor: "theme:border", overflow: "hidden" } },
    WB_InfoHead: { type: "Box", style: { minHeight: 52, alignItems: "center", justifyContent: "center", gap: 3, padding: 9, borderBottomWidth: 1, borderBottomColor: "theme:border" } },
    WB_InfoTitle: { type: "Text", fontSize: 11, color: "theme:text", noWrap: true, numberOfLines: 1, style: { fontWeight: 900 } },
    WB_InfoKind: { type: "Text", fontSize: 7, color: "theme:textFaint", noWrap: true, style: { fontFamily: MONO, fontWeight: 800, letterSpacing: 0.7 } },
    WB_FactRow: { type: "Box", style: { minHeight: 46, flexDirection: "row", gap: 8, padding: 9, borderBottomWidth: 1, borderBottomColor: "theme:borderSoft" } },
    WB_FactLabelCol: { type: "Box", style: { width: 88, flexDirection: "column", gap: 4 } },
    WB_FactLabel: { type: "Text", fontSize: 7, color: "theme:textFaint", style: { fontFamily: MONO, fontWeight: 900, letterSpacing: 0.4 } },
    WB_FactValue: { type: "Text", fontSize: 9, color: "theme:textSecondary", style: { flexGrow: 1, minWidth: 0, lineHeight: 13 } },
    WB_ScopeText: { type: "Text", fontSize: 6, noWrap: true, style: { fontFamily: MONO, fontWeight: 900, letterSpacing: 0.3 } },
    WB_SourceCard: { type: "Box", style: { flexDirection: "column", gap: 5, padding: 9, borderRadius: 4, backgroundColor: "theme:controlBg", borderWidth: 1, borderColor: "theme:borderSoft" } },
    WB_SourcePath: { type: "Text", fontSize: 7, color: "theme:textDim", style: { fontFamily: MONO, lineHeight: 11 } },
    WB_Backlink: { type: "Pressable", style: { minHeight: 30, flexDirection: "row", alignItems: "center", gap: 7, paddingLeft: 8, paddingRight: 8, borderRadius: 3, backgroundColor: "theme:controlBg", borderWidth: 1, borderColor: "theme:borderSoft" }, hoverStyle: { borderColor: "theme:primary" } },
    WB_EditScroll: { type: "ScrollView", style: { flexGrow: 1, minHeight: 0 } },
    WB_EditBody: { type: "Box", style: { flexDirection: "column", gap: 18, paddingLeft: 28, paddingRight: 28, paddingTop: 22, paddingBottom: 44 } },
    WB_FormRow: { type: "Box", style: { flexDirection: "row", gap: 10 } },
    WB_Field: { type: "Box", style: { flexGrow: 1, minWidth: 0, flexDirection: "column", gap: 5 } },
    WB_FieldLabel: { type: "Text", fontSize: 7, color: "theme:textDim", noWrap: true, style: { fontFamily: MONO, fontWeight: 900, letterSpacing: 0.6 } },
    WB_Input: { type: "TextInput", style: { height: 32, paddingLeft: 9, paddingRight: 9, borderRadius: 3, backgroundColor: "theme:controlBg", borderWidth: 1, borderColor: "theme:controlBorder", color: "theme:text", fontSize: 10, fontFamily: MONO } },
    WB_InputReadOnly: { type: "Box", style: { height: 32, justifyContent: "center", paddingLeft: 9, paddingRight: 9, borderRadius: 3, backgroundColor: "theme:bgAlt", borderWidth: 1, borderColor: "theme:borderSoft" } },
    WB_FactEdit: { type: "Box", style: { flexDirection: "column", gap: 7, padding: 9, borderRadius: 4, backgroundColor: "theme:bgAlt", borderWidth: 1, borderColor: "theme:borderSoft" } },
    WB_FactEditHead: { type: "Box", style: { flexDirection: "row", alignItems: "center", gap: 7 } },
    WB_FactKey: { type: "Text", fontSize: 8, color: "theme:primary", noWrap: true, style: { flexGrow: 1, minWidth: 0, fontFamily: MONO, fontWeight: 900 } },
    WB_Review: { type: "Box", style: { flexGrow: 1, minHeight: 0, flexDirection: "column", padding: 18, gap: 12, backgroundColor: "theme:bgAlt" } },
    WB_ReviewMeta: { type: "Box", style: { flexDirection: "column", gap: 5, padding: 10, borderRadius: 4, backgroundColor: "theme:controlBg", borderWidth: 1, borderColor: "theme:warning" } },
    WB_ReviewCols: { type: "Box", style: { flexGrow: 1, minHeight: 0, flexDirection: "row", gap: 10 } },
    WB_ReviewCol: { type: "Box", style: { flexGrow: 1, minWidth: 0, minHeight: 0, flexDirection: "column", gap: 7, padding: 10, borderRadius: 4, backgroundColor: "theme:surface", borderWidth: 1, borderColor: "theme:border" } },
    WB_ReviewScroll: { type: "ScrollView", style: { flexGrow: 1, minHeight: 0 } },
    WB_DiffText: { type: "Text", fontSize: 8, color: "theme:textSecondary", style: { fontFamily: MONO, lineHeight: 12 } },
    WB_ChangeRow: { type: "Box", style: { flexDirection: "column", gap: 4, padding: 8, borderBottomWidth: 1, borderBottomColor: "theme:borderSoft" } }
  });

  // cart/editor/worldBible/worldBibleStyle.test.ts
  var log = globalThis.print ?? ((value) => globalThis.__writeStdout?.(`${value}
`));
  if (typeof classifiers.WB_Surface !== "function" || typeof classifiers.WB_IndexPanel !== "function" || typeof classifiers.WB_Review !== "function" || typeof classifiers.WB_AuthorMarkdown !== "function" || typeof classifiers.WB_DiagnosticPanel !== "function" || typeof classifiers.WB_DiscardConfirm !== "function") {
    throw new Error("World Bible classifier surface did not register");
  }
  log("  ok  World Bible classifier sheet registers valid primitives");
})();
/*! Bundled license information:

react/cjs/react.production.js:
  (**
   * @license React
   * react.production.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

react/cjs/react.development.js:
  (**
   * @license React
   * react.development.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)
*/
