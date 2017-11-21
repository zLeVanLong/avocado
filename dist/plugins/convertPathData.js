"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var _path_1 = require("./_path");
var _tools_1 = require("./_tools");
var roundData;
var precision;
var error;
var arcThreshold;
var arcTolerance;
exports.defaultParams = {
    applyTransforms: true,
    applyTransformsStroked: true,
    makeArcs: {
        threshold: 2.5,
        tolerance: 0.5,
    },
    straightCurves: true,
    lineShorthands: true,
    curveSmoothShorthands: true,
    floatPrecision: 3,
    transformPrecision: 5,
    removeUseless: true,
    collapseRepeated: true,
    utilizeAbsolute: true,
    leadingZero: true,
    negativeExtraSpace: true,
};
/**
 * Convert absolute Path to relative, collapse repeated instructions,
 * detect and convert Lineto shorthands, remove useless instructions like "l0,0",
 * trim useless delimiters and leading zeros, decrease accuracy of floating-point numbers.
 */
function fn(item, params) {
    if (!(item.isElem('path') || item.isElem('clip-path')) ||
        // TODO: properly reference the attribute using the correct namespace
        !item.hasAttr('android:pathData')) {
        return item;
    }
    precision = params.floatPrecision;
    error = +Math.pow(0.1, precision).toFixed(precision);
    roundData = precision > 0 && precision < 20 ? strongRound : round;
    if (params.makeArcs) {
        arcThreshold = params.makeArcs.threshold;
        arcTolerance = params.makeArcs.tolerance;
    }
    var data = _path_1.path2js(item);
    if (!data.length) {
        return item;
    }
    convertToRelative(data);
    if (params.applyTransforms) {
        data = _path_1.applyTransforms(item, data, params);
    }
    data = filters(data, params);
    if (params.utilizeAbsolute) {
        data = convertToMixed(data, params);
    }
    _path_1.js2path(item, data, params);
    return item;
}
/**
 * Convert absolute path data coordinates to relative.
 *
 * @param {Array} path input path data
 * @param {Object} params plugin params
 * @return {Array} output path data
 */
function convertToRelative(path) {
    var point = [0, 0];
    var subpathPoint = [0, 0];
    var baseItem;
    path.forEach(function (item, index) {
        var instruction = item.instruction;
        var data = item.data;
        // data !== !z
        if (data) {
            // already relative
            // recalculate current point
            if ('mcslqta'.indexOf(instruction) > -1) {
                point[0] += data[data.length - 2];
                point[1] += data[data.length - 1];
                if (instruction === 'm') {
                    subpathPoint[0] = point[0];
                    subpathPoint[1] = point[1];
                    baseItem = item;
                }
            }
            else if (instruction === 'h') {
                point[0] += data[0];
            }
            else if (instruction === 'v') {
                point[1] += data[0];
            }
            // convert absolute path data coordinates to relative
            // if "M" was not transformed from "m"
            // M → m
            if (instruction === 'M') {
                if (index > 0) {
                    instruction = 'm';
                }
                data[0] -= point[0];
                data[1] -= point[1];
                subpathPoint[0] = point[0] += data[0];
                subpathPoint[1] = point[1] += data[1];
                baseItem = item;
            }
            else if ('LT'.indexOf(instruction) > -1) {
                // L → l
                // T → t
                instruction = instruction.toLowerCase();
                // x y
                // 0 1
                data[0] -= point[0];
                data[1] -= point[1];
                point[0] += data[0];
                point[1] += data[1];
                // C → c
            }
            else if (instruction === 'C') {
                instruction = 'c';
                // x1 y1 x2 y2 x y
                // 0  1  2  3  4 5
                data[0] -= point[0];
                data[1] -= point[1];
                data[2] -= point[0];
                data[3] -= point[1];
                data[4] -= point[0];
                data[5] -= point[1];
                point[0] += data[4];
                point[1] += data[5];
                // S → s
                // Q → q
            }
            else if ('SQ'.indexOf(instruction) > -1) {
                instruction = instruction.toLowerCase();
                // x1 y1 x y
                // 0  1  2 3
                data[0] -= point[0];
                data[1] -= point[1];
                data[2] -= point[0];
                data[3] -= point[1];
                point[0] += data[2];
                point[1] += data[3];
                // A → a
            }
            else if (instruction === 'A') {
                instruction = 'a';
                // rx ry x-axis-rotation large-arc-flag sweep-flag x y
                // 0  1  2               3              4          5 6
                data[5] -= point[0];
                data[6] -= point[1];
                point[0] += data[5];
                point[1] += data[6];
                // H → h
            }
            else if (instruction === 'H') {
                instruction = 'h';
                data[0] -= point[0];
                point[0] += data[0];
                // V → v
            }
            else if (instruction === 'V') {
                instruction = 'v';
                data[0] -= point[1];
                point[1] += data[0];
            }
            item.instruction = instruction;
            item.data = data;
            // store absolute coordinates for later use
            item.coords = point.slice(-2);
        }
        else if (instruction === 'z') {
            // !data === z, reset current point
            if (baseItem) {
                item.coords = baseItem.coords;
            }
            point[0] = subpathPoint[0];
            point[1] = subpathPoint[1];
        }
        item.base = index > 0 ? path[index - 1].coords : [0, 0];
    });
    return path;
}
function filters(pathRes, params) {
    var stringify = data2Path.bind(undefined, params);
    var relSubpoint = [0, 0];
    var pathBase = [0, 0];
    var prev = {};
    pathRes = pathRes.filter(function (item, index, path) {
        var instruction = item.instruction;
        var data = item.data;
        var next = path[index + 1];
        if (data) {
            var sdata = data;
            var circle = void 0;
            if (instruction === 's') {
                sdata = [0, 0].concat(data);
                if ('cs'.indexOf(prev.instruction) > -1) {
                    var pdata = prev.data;
                    var n = pdata.length;
                    // (-x, -y) of the prev tangent point relative to the current point
                    sdata[0] = pdata[n - 2] - pdata[n - 4];
                    sdata[1] = pdata[n - 1] - pdata[n - 3];
                }
            }
            // convert curves to arcs if possible
            if (params.makeArcs &&
                (instruction === 'c' || instruction === 's') &&
                isConvex(sdata) &&
                (circle = findCircle(sdata))) {
                var r = roundData([circle.radius])[0];
                var angle = findArcAngle(sdata, circle);
                var sweep = sdata[5] * sdata[0] - sdata[4] * sdata[1] > 0 ? 1 : 0;
                var arc = {
                    instruction: 'a',
                    data: [r, r, 0, 0, sweep, sdata[4], sdata[5]],
                    coords: item.coords.slice(),
                    base: item.base,
                };
                var output = [arc];
                // relative coordinates to adjust the found circle
                var relCenter = [
                    circle.center[0] - sdata[4],
                    circle.center[1] - sdata[5],
                ];
                var relCircle = { center: relCenter, radius: circle.radius };
                var arcCurves = [item];
                var hasPrev = 0;
                var suffix = '';
                var nextLonghand = void 0;
                if ((prev.instruction === 'c' &&
                    isConvex(prev.data) &&
                    isArcPrev(prev.data, circle)) ||
                    (prev.instruction === 'a' &&
                        prev.sdata &&
                        isArcPrev(prev.sdata, circle))) {
                    arcCurves.unshift(prev);
                    arc.base = prev.base;
                    arc.data[5] = arc.coords[0] - arc.base[0];
                    arc.data[6] = arc.coords[1] - arc.base[1];
                    var prevData = prev.instruction === 'a' ? prev.sdata : prev.data;
                    angle += findArcAngle(prevData, {
                        center: [prevData[4] + relCenter[0], prevData[5] + relCenter[1]],
                        radius: circle.radius,
                    });
                    if (angle > Math.PI) {
                        arc.data[3] = 1;
                    }
                    hasPrev = 1;
                }
                // check if next curves are fitting the arc
                var j = index;
                // tslint:disable-next-line:no-bitwise
                for (; (next = path[++j]) && ~'cs'.indexOf(next.instruction);) {
                    var nextData = next.data;
                    if (next.instruction === 's') {
                        nextLonghand = makeLonghand({ instruction: 's', data: next.data.slice() }, path[j - 1].data);
                        nextData = nextLonghand.data;
                        nextLonghand.data = nextData.slice(0, 2);
                        suffix = stringify([nextLonghand]);
                    }
                    if (isConvex(nextData) && isArc(nextData, relCircle)) {
                        angle += findArcAngle(nextData, relCircle);
                        if (angle - 2 * Math.PI > 1e-3) {
                            break; // more than 360°
                        }
                        if (angle > Math.PI) {
                            arc.data[3] = 1;
                        }
                        arcCurves.push(next);
                        if (2 * Math.PI - angle > 1e-3) {
                            // less than 360°
                            arc.coords = next.coords;
                            arc.data[5] = arc.coords[0] - arc.base[0];
                            arc.data[6] = arc.coords[1] - arc.base[1];
                        }
                        else {
                            // full circle, make a half-circle arc and add a second one
                            arc.data[5] = 2 * (relCircle.center[0] - nextData[4]);
                            arc.data[6] = 2 * (relCircle.center[1] - nextData[5]);
                            arc.coords = [
                                arc.base[0] + arc.data[5],
                                arc.base[1] + arc.data[6],
                            ];
                            arc = {
                                instruction: 'a',
                                data: [
                                    r,
                                    r,
                                    0,
                                    0,
                                    sweep,
                                    next.coords[0] - arc.coords[0],
                                    next.coords[1] - arc.coords[1],
                                ],
                                coords: next.coords,
                                base: arc.coords,
                            };
                            output.push(arc);
                            j++;
                            break;
                        }
                        relCenter[0] -= nextData[4];
                        relCenter[1] -= nextData[5];
                    }
                    else {
                        break;
                    }
                }
                if ((stringify(output) + suffix).length < stringify(arcCurves).length) {
                    if (path[j] && path[j].instruction === 's') {
                        makeLonghand(path[j], path[j - 1].data);
                    }
                    if (hasPrev) {
                        var prevArc = output.shift();
                        roundData(prevArc.data);
                        relSubpoint[0] += prevArc.data[5] - prev.data[prev.data.length - 2];
                        relSubpoint[1] += prevArc.data[6] - prev.data[prev.data.length - 1];
                        prev.instruction = 'a';
                        prev.data = prevArc.data;
                        item.base = prev.coords = prevArc.coords;
                    }
                    arc = output.shift();
                    if (arcCurves.length === 1) {
                        item.sdata = sdata.slice(); // preserve curve data for future checks
                    }
                    else if (arcCurves.length - 1 - hasPrev > 0) {
                        // filter out consumed next items
                        path.splice.apply(path, [
                            index + 1,
                            arcCurves.length - 1 - hasPrev
                        ].concat(output));
                    }
                    if (!arc) {
                        return false;
                    }
                    instruction = 'a';
                    data = arc.data;
                    item.coords = arc.coords;
                }
            }
            // Rounding relative coordinates, taking in account accummulating error
            // to get closer to absolute coordinates. Sum of rounded value remains same:
            // l .25 3 .25 2 .25 3 .25 2 -> l .3 3 .2 2 .3 3 .2 2
            if ('mltqsc'.indexOf(instruction) > -1) {
                for (var i = data.length; i--;) {
                    data[i] += item.base[i % 2] - relSubpoint[i % 2];
                }
            }
            else if (instruction === 'h') {
                data[0] += item.base[0] - relSubpoint[0];
            }
            else if (instruction === 'v') {
                data[0] += item.base[1] - relSubpoint[1];
            }
            else if (instruction === 'a') {
                data[5] += item.base[0] - relSubpoint[0];
                data[6] += item.base[1] - relSubpoint[1];
            }
            roundData(data);
            if (instruction === 'h') {
                relSubpoint[0] += data[0];
            }
            else if (instruction === 'v') {
                relSubpoint[1] += data[0];
            }
            else {
                relSubpoint[0] += data[data.length - 2];
                relSubpoint[1] += data[data.length - 1];
            }
            roundData(relSubpoint);
            if (instruction.toLowerCase() === 'm') {
                pathBase[0] = relSubpoint[0];
                pathBase[1] = relSubpoint[1];
            }
            // convert straight curves into lines segments
            if (params.straightCurves) {
                if ((instruction === 'c' && isCurveStraightLine(data)) ||
                    (instruction === 's' && isCurveStraightLine(sdata))) {
                    if (next && next.instruction === 's') {
                        makeLonghand(next, data); // fix up next curve
                    }
                    instruction = 'l';
                    data = data.slice(-2);
                }
                else if (instruction === 'q' && isCurveStraightLine(data)) {
                    if (next && next.instruction === 't') {
                        makeLonghand(next, data); // fix up next curve
                    }
                    instruction = 'l';
                    data = data.slice(-2);
                }
                else if (instruction === 't' &&
                    prev.instruction !== 'q' &&
                    prev.instruction !== 't') {
                    instruction = 'l';
                    data = data.slice(-2);
                }
                else if (instruction === 'a' && (data[0] === 0 || data[1] === 0)) {
                    instruction = 'l';
                    data = data.slice(-2);
                }
            }
            // horizontal and vertical line shorthands
            // l 50 0 → h 50
            // l 0 50 → v 50
            if (params.lineShorthands && instruction === 'l') {
                if (data[1] === 0) {
                    instruction = 'h';
                    data.pop();
                }
                else if (data[0] === 0) {
                    instruction = 'v';
                    data.shift();
                }
            }
            // collapse repeated commands
            // h 20 h 30 -> h 50
            if (params.collapseRepeated &&
                'mhv'.indexOf(instruction) > -1 &&
                prev.instruction &&
                instruction === prev.instruction.toLowerCase() &&
                ((instruction !== 'h' && instruction !== 'v') ||
                    prev.data[0] >= 0 === item.data[0] >= 0)) {
                prev.data[0] += data[0];
                if (instruction !== 'h' && instruction !== 'v') {
                    prev.data[1] += data[1];
                }
                prev.coords = item.coords;
                path[index] = prev;
                return false;
            }
            // convert curves into smooth shorthands
            if (params.curveSmoothShorthands && prev.instruction) {
                // curveto
                if (instruction === 'c') {
                    // c + c → c + s
                    if (prev.instruction === 'c' &&
                        data[0] === -(prev.data[2] - prev.data[4]) &&
                        data[1] === -(prev.data[3] - prev.data[5])) {
                        instruction = 's';
                        data = data.slice(2);
                    }
                    else if (prev.instruction === 's' &&
                        data[0] === -(prev.data[0] - prev.data[2]) &&
                        data[1] === -(prev.data[1] - prev.data[3])) {
                        // s + c → s + s
                        instruction = 's';
                        data = data.slice(2);
                    }
                    else if ('cs'.indexOf(prev.instruction) === -1 &&
                        data[0] === 0 &&
                        data[1] === 0) {
                        // [^cs] + c → [^cs] + s
                        instruction = 's';
                        data = data.slice(2);
                    }
                }
                else if (instruction === 'q') {
                    // quadratic Bézier curveto
                    // q + q → q + t
                    if (prev.instruction === 'q' &&
                        data[0] === prev.data[2] - prev.data[0] &&
                        data[1] === prev.data[3] - prev.data[1]) {
                        instruction = 't';
                        data = data.slice(2);
                    }
                    else if (prev.instruction === 't' &&
                        data[2] === prev.data[0] &&
                        data[3] === prev.data[1]) {
                        // t + q → t + t
                        instruction = 't';
                        data = data.slice(2);
                    }
                }
            }
            // remove useless non-first path segments
            if (params.removeUseless) {
                // l 0,0 / h 0 / v 0 / q 0,0 0,0 / t 0,0 / c 0,0 0,0 0,0 / s 0,0 0,0
                if ('lhvqtcs'.indexOf(instruction) > -1 && data.every(function (i) { return i === 0; })) {
                    path[index] = prev;
                    return false;
                }
                // a 25,25 -30 0,1 0,0
                if (instruction === 'a' && data[5] === 0 && data[6] === 0) {
                    path[index] = prev;
                    return false;
                }
            }
            item.instruction = instruction;
            item.data = data;
            prev = item;
        }
        else {
            // z resets coordinates
            relSubpoint[0] = pathBase[0];
            relSubpoint[1] = pathBase[1];
            if (prev.instruction === 'z') {
                return false;
            }
            prev = item;
        }
        return true;
    });
    return pathRes;
}
/**
 * Writes data in shortest form using absolute or relative coordinates.
 * @param {Array} data input path data
 * @return {Boolean} output
 */
function convertToMixed(path, params) {
    var prev = path[0];
    path = path.filter(function (item, index) {
        if (index === 0) {
            return true;
        }
        if (!item.data) {
            prev = item;
            return true;
        }
        var instruction = item.instruction;
        var data = item.data;
        var adata = data && data.slice(0);
        if ('mltqsc'.indexOf(instruction) > -1) {
            for (var i = adata.length; i--;) {
                adata[i] += item.base[i % 2];
            }
        }
        else if (instruction === 'h') {
            adata[0] += item.base[0];
        }
        else if (instruction === 'v') {
            adata[0] += item.base[1];
        }
        else if (instruction === 'a') {
            adata[5] += item.base[0];
            adata[6] += item.base[1];
        }
        roundData(adata);
        var absoluteDataStr = _tools_1.cleanupOutData(adata, params);
        var relativeDataStr = _tools_1.cleanupOutData(data, params);
        // Convert to absolute coordinates if it's shorter.
        // v-20 -> V0
        // Don't convert if it fits following previous instruction.
        // l20 30-10-50 instead of l20 30L20 30
        if (absoluteDataStr.length < relativeDataStr.length &&
            !(params.negativeExtraSpace &&
                instruction === prev.instruction &&
                prev.instruction.charCodeAt(0) > 96 &&
                absoluteDataStr.length === relativeDataStr.length - 1 &&
                (data[0] < 0 ||
                    (/^0\./.test(data[0]) && prev.data[prev.data.length - 1] % 1)))) {
            item.instruction = instruction.toUpperCase();
            item.data = adata;
        }
        prev = item;
        return true;
    });
    return path;
}
/**
 * Checks if curve is convex. Control points of such a curve must form
 * a convex quadrilateral with diagonals crosspoint inside of it.
 *
 * @param {Array} data input path data
 * @return {Boolean} output
 */
function isConvex(data) {
    var center = getIntersection([
        0,
        0,
        data[2],
        data[3],
        data[0],
        data[1],
        data[4],
        data[5],
    ]);
    return (center &&
        data[2] < center[0] === center[0] < 0 &&
        data[3] < center[1] === center[1] < 0 &&
        data[4] < center[0] === center[0] < data[0] &&
        data[5] < center[1] === center[1] < data[1]);
}
/**
 * Computes lines equations by two points and returns their intersection point.
 *
 * @param {Array} coords 8 numbers for 4 pairs of coordinates (x,y)
 * @return {Array|undefined} output coordinate of lines' crosspoint
 */
function getIntersection(coords) {
    // Prev line equation parameters.
    var a1 = coords[1] - coords[3]; // y1 - y2
    var b1 = coords[2] - coords[0]; // x2 - x1
    var c1 = coords[0] * coords[3] - coords[2] * coords[1]; // x1 * y2 - x2 * y1
    // Next line equation parameters
    var a2 = coords[5] - coords[7]; // y1 - y2
    var b2 = coords[6] - coords[4]; // x2 - x1
    var c2 = coords[4] * coords[7] - coords[5] * coords[6]; // x1 * y2 - x2 * y1
    var denom = a1 * b2 - a2 * b1;
    if (!denom) {
        return; // parallel lines havn't an intersection
    }
    var cross = [(b1 * c2 - b2 * c1) / denom, (a1 * c2 - a2 * c1) / -denom];
    if (!isNaN(cross[0]) &&
        !isNaN(cross[1]) &&
        isFinite(cross[0]) &&
        isFinite(cross[1])) {
        return cross;
    }
    return undefined;
}
/**
 * Decrease accuracy of floating-point numbers
 * in path data keeping a specified number of decimals.
 * Smart rounds values like 2.3491 to 2.35 instead of 2.349.
 * Doesn't apply "smartness" if the number precision fits already.
 *
 * @param {Array} data input data array
 * @return {Array} output data array
 */
function strongRound(data) {
    for (var i = data.length; i-- > 0;) {
        if (+data[i].toFixed(precision) !== data[i]) {
            var rounded = +data[i].toFixed(precision - 1);
            data[i] =
                +Math.abs(rounded - data[i]).toFixed(precision + 1) >= error
                    ? +data[i].toFixed(precision)
                    : rounded;
        }
    }
    return data;
}
/**
 * Checks if a curve is a straight line by measuring distance
 * from middle points to the line formed by end points.
 */
function isCurveStraightLine(data) {
    // Get line equation a·x + b·y + c = 0 coefficients a, b (c = 0) by start and end points.
    var i = data.length - 2;
    var a = -data[i + 1]; // y1 − y2 (y1 = 0)
    var b = data[i]; // x2 − x1 (x1 = 0)
    var d = 1 / (a * a + b * b); // same part for all points
    if (i <= 1 || !isFinite(d)) {
        // Curve that ends at start point isn't the case.
        return false;
    }
    // Distance from point (x0, y0) to the line is sqrt((c − a·x0 − b·y0)² / (a² + b²))
    while ((i -= 2) >= 0) {
        if (Math.sqrt(Math.pow(a * data[i] + b * data[i + 1], 2) * d) > error) {
            return false;
        }
    }
    return true;
}
/**
 * Converts next curve from shorthand to full form using the current curve data.
 */
function makeLonghand(item, data) {
    switch (item.instruction) {
        case 's':
            item.instruction = 'c';
            break;
        case 't':
            item.instruction = 'q';
            break;
    }
    item.data.unshift(data[data.length - 2] - data[data.length - 4], data[data.length - 1] - data[data.length - 3]);
    return item;
}
/**
 * Returns distance between two points.
 */
function getDistance(p1, p2) {
    return Math.sqrt(Math.pow(p1[0] - p2[0], 2) + Math.pow(p1[1] - p2[1], 2));
}
/**
 * Returns coordinates of the curve point corresponding to the certain t
 * a·(1 - t)³·p1 + b·(1 - t)²·t·p2 + c·(1 - t)·t²·p3 + d·t³·p4,
 * where pN are control points and p1 is zero due to relative coordinates.
 * @param {Array} curve array of curve points coordinates
 * @param {Number} t parametric position from 0 to 1
 * @return {Array} Point coordinates
 */
function getCubicBezierPoint(curve, t) {
    var sqrT = t * t;
    var cubT = sqrT * t;
    var mt = 1 - t;
    var sqrMt = mt * mt;
    return [
        3 * sqrMt * t * curve[0] + 3 * mt * sqrT * curve[2] + cubT * curve[4],
        3 * sqrMt * t * curve[1] + 3 * mt * sqrT * curve[3] + cubT * curve[5],
    ];
}
/**
 * Finds circle by 3 points of the curve and checks if the curve fits the found circle.
 *
 * @param {Array} curve
 * @return {Object|undefined} circle
 */
function findCircle(curve) {
    var midPoint = getCubicBezierPoint(curve, 1 / 2);
    var m1 = [midPoint[0] / 2, midPoint[1] / 2];
    var m2 = [(midPoint[0] + curve[4]) / 2, (midPoint[1] + curve[5]) / 2];
    var center = getIntersection([
        m1[0],
        m1[1],
        m1[0] + m1[1],
        m1[1] - m1[0],
        m2[0],
        m2[1],
        m2[0] + (m2[1] - midPoint[1]),
        m2[1] - (m2[0] - midPoint[0]),
    ]);
    var radius = center && getDistance([0, 0], center);
    var tolerance = Math.min(arcThreshold * error, arcTolerance * radius / 100);
    if (center &&
        [1 / 4, 3 / 4].every(function (point) {
            return (Math.abs(getDistance(getCubicBezierPoint(curve, point), center) - radius) <= tolerance);
        })) {
        return { center: center, radius: radius };
    }
    return undefined;
}
/**
 * Checks if a curve fits the given circle.
 * @param {Object} circle
 * @param {Array} curve
 * @return {Boolean}
 */
function isArc(curve, circle) {
    var tolerance = Math.min(arcThreshold * error, arcTolerance * circle.radius / 100);
    return [0, 1 / 4, 1 / 2, 3 / 4, 1].every(function (point) {
        return (Math.abs(getDistance(getCubicBezierPoint(curve, point), circle.center) -
            circle.radius) <= tolerance);
    });
}
/**
 * Checks if a previous curve fits the given circle.
 * @param {Object} circle
 * @param {Array} curve
 * @return {Boolean}
 */
function isArcPrev(curve, circle) {
    return isArc(curve, {
        center: [circle.center[0] + curve[4], circle.center[1] + curve[5]],
        radius: circle.radius,
    });
}
/**
 * Finds angle of a curve fitting the given arc.
 * @param {Array} curve
 * @param {Object} relCircle
 * @return {Number} angle
 */
function findArcAngle(curve, relCircle) {
    var x1 = -relCircle.center[0];
    var y1 = -relCircle.center[1];
    var x2 = curve[4] - relCircle.center[0];
    var y2 = curve[5] - relCircle.center[1];
    return Math.acos((x1 * x2 + y1 * y2) / Math.sqrt((x1 * x1 + y1 * y1) * (x2 * x2 + y2 * y2)));
}
/**
 * Converts given path data to string.
 *
 * @param {Object} params
 * @param {Array} pathData
 * @return {String}
 */
function data2Path(params, pathData) {
    return pathData.reduce(function (pathString, item) {
        return (pathString +
            item.instruction +
            (item.data ? _tools_1.cleanupOutData(roundData(item.data.slice()), params) : ''));
    }, '');
}
/**
 * Simple rounding function if precision is 0.
 *
 * @param {Array} data input data array
 * @return {Array} output data array
 */
function round(data) {
    for (var i = data.length; i-- > 0;) {
        data[i] = Math.round(data[i]);
    }
    return data;
}
exports.convertPathData = {
    type: 'perItem',
    active: true,
    description: 'optimizes path data: writes in shorter form, applies transformations',
    params: exports.defaultParams,
    fn: fn,
};