import {isArray} from 'vega-util';
import {FieldRefOption, isFieldDef, isValueDef, vgField} from '../../channeldef';
import {MAIN} from '../../data';
import {isAggregate, pathGroupingFields} from '../../encoding';
import {AREA, BAR, isPathMark, LINE, Mark, RECT, TRAIL} from '../../mark';
import {isSortByEncoding, isSortField} from '../../sort';
import {contains, getFirstDefined, isNullOrFalse, keys, omit, pick} from '../../util';
import {VgCompare, VgEncodeChannel, VgEncodeEntry} from '../../vega.schema';
import {getMarkConfig, getStyles, sortParams} from '../common';
import {UnitModel} from '../unit';
import {area} from './area';
import {bar} from './bar';
import {MarkCompiler} from './base';
import {geoshape} from './geoshape';
import {image} from './image';
import {line, trail} from './line';
import {circle, point, square} from './point';
import {rect} from './rect';
import {rule} from './rule';
import {text} from './text';
import {tick} from './tick';

const markCompiler: {[m in Mark]: MarkCompiler} = {
  area,
  bar,
  circle,
  geoshape,
  image,
  line,
  point,
  rect,
  rule,
  square,
  text,
  tick,
  trail
};

export function parseMarkGroups(model: UnitModel): any[] {
  if (contains([LINE, AREA, TRAIL], model.mark)) {
    return parsePathMark(model);
  } else if (contains([BAR, RECT], model.mark)) {
    return getStackGroups(model);
  } else {
    return getMarkGroups(model);
  }
}

const FACETED_PATH_PREFIX = 'faceted_path_';

function parsePathMark(model: UnitModel) {
  const details = pathGroupingFields(model.mark, model.encoding);

  const pathMarks = getMarkGroups(model, {
    // If has subfacet for line/area group, need to use faceted data from below.
    fromPrefix: details.length > 0 ? FACETED_PATH_PREFIX : ''
  });

  if (details.length > 0) {
    // have level of details - need to facet line into subgroups
    // TODO: for non-stacked plot, map order to zindex. (Maybe rename order for layer to zindex?)

    return [
      {
        name: model.getName('pathgroup'),
        type: 'group',
        from: {
          facet: {
            name: FACETED_PATH_PREFIX + model.requestDataName(MAIN),
            data: model.requestDataName(MAIN),
            groupby: details
          }
        },
        encode: {
          update: {
            width: {field: {group: 'width'}},
            height: {field: {group: 'height'}}
          }
        },
        marks: pathMarks
      }
    ];
  } else {
    return pathMarks;
  }
}

const STACK_GROUP_PREFIX = 'stack_group_';

function getStackGroups(model: UnitModel) {
  // Use groups for stacked bar/rects, don't use if size is encoded.
  if (model.stack && !model.fieldDef('size')) {
    const [mark] = getMarkGroups(model, {fromPrefix: STACK_GROUP_PREFIX});
    const fieldScale = model.scaleName(model.stack.fieldChannel);

    const stackField = (opt: FieldRefOption = {}) => model.vgField(model.stack.fieldChannel, opt);
    const stackFieldGroup = (func: 'min' | 'max', opt: FieldRefOption) => {
      const vgFieldMinMax = [
        stackField({prefix: 'min', suffix: 'start', ...opt}),
        stackField({prefix: 'max', suffix: 'start', ...opt}),
        stackField({prefix: 'min', suffix: 'end', ...opt}),
        stackField({prefix: 'max', suffix: 'end', ...opt})
      ];
      return func + '(' + vgFieldMinMax.map(field => `scale('${fieldScale}',${field})`).join(',') + ')';
    };

    let groupEncode: VgEncodeEntry;
    let innerGroupEncode: VgEncodeEntry;

    if (model.stack.fieldChannel == 'x') {
      groupEncode = {
        ...pick(mark.encode.update, ['y', 'yc', 'y2', 'height']),
        x: {signal: stackFieldGroup('min', {expr: 'datum'})},
        x2: {signal: stackFieldGroup('max', {expr: 'datum'})}
      };
      innerGroupEncode = {
        x: {signal: '-' + stackFieldGroup('min', {expr: 'parent'})},
        height: {field: {group: 'height'}}
      };
      mark.encode.update = {
        ...omit(mark.encode.update, ['y', 'yc', 'y2']),
        height: {field: {group: 'height'}}
      };
    } else {
      groupEncode = {
        ...pick(mark.encode.update, ['x', 'xc', 'x2', 'width']),
        y: {signal: stackFieldGroup('min', {expr: 'datum'})},
        y2: {signal: stackFieldGroup('max', {expr: 'datum'})}
      };
      innerGroupEncode = {
        y: {signal: '-' + stackFieldGroup('min', {expr: 'parent'})},
        width: {field: {group: 'width'}}
      };
      mark.encode.update = {
        ...omit(mark.encode.update, ['x', 'xc', 'x2']),
        width: {field: {group: 'width'}}
      };
    }

    const cornerRadiusChannels: VgEncodeChannel[] = [
      'cornerRadius',
      'cornerRadiusTopLeft',
      'cornerRadiusTopRight',
      'cornerRadiusBottomLeft',
      'cornerRadiusBottomRight'
    ];
    groupEncode = {
      ...groupEncode,
      ...pick(mark.encode.update, cornerRadiusChannels)
    };
    mark.encode.update = {
      ...mark.encode.update,
      cornerRadiusTopLeft: {value: 0},
      cornerRadiusTopRight: {value: 0},
      cornerRadiusBottomLeft: {value: 0},
      cornerRadiusBottomRight: {value: 0}
    };

    // For bin we have to add bin channels.
    const groupby: string[] = model.vgField(model.stack.groupbyChannel)
      ? [model.vgField(model.stack.groupbyChannel)]
      : [];
    if (model.fieldDef(model.stack.groupbyChannel) && model.fieldDef(model.stack.groupbyChannel).bin) {
      groupby.push(model.vgField(model.stack.groupbyChannel, {binSuffix: 'end'}));
    }

    return [
      {
        type: 'group',
        from: {
          facet: {
            data: model.requestDataName(MAIN),
            name: STACK_GROUP_PREFIX + model.requestDataName(MAIN),
            groupby,
            aggregate: {
              fields: [
                stackField({suffix: 'start'}),
                stackField({suffix: 'start'}),
                stackField({suffix: 'end'}),
                stackField({suffix: 'end'})
              ],
              ops: ['min', 'max', 'min', 'max']
            }
          }
        },
        encode: {
          update: {
            clip: {value: true},
            ...groupEncode
          }
        },
        marks: [
          {
            type: 'group',
            encode: {update: innerGroupEncode},
            marks: [mark]
          }
        ]
      }
    ];
  } else {
    return getMarkGroups(model);
  }
}

export function getSort(model: UnitModel): VgCompare {
  const {encoding, stack, mark, markDef, config} = model;
  const order = encoding.order;
  if (
    (!isArray(order) && isValueDef(order) && isNullOrFalse(order.value)) ||
    (!order && isNullOrFalse(markDef.order)) ||
    isNullOrFalse(getMarkConfig('order', markDef, config))
  ) {
    return undefined;
  } else if ((isArray(order) || isFieldDef(order)) && !stack) {
    // Sort by the order field if it is specified and the field is not stacked. (For stacked field, order specify stack order.)
    return sortParams(order, {expr: 'datum'});
  } else if (isPathMark(mark)) {
    // For both line and area, we sort values based on dimension by default
    const dimensionChannel = markDef.orient === 'horizontal' ? 'y' : 'x';
    const dimensionChannelDef = encoding[dimensionChannel];
    if (isFieldDef(dimensionChannelDef)) {
      const s = dimensionChannelDef.sort;

      if (isArray(s)) {
        return {
          field: vgField(dimensionChannelDef, {prefix: dimensionChannel, suffix: 'sort_index', expr: 'datum'})
        };
      } else if (isSortField(s)) {
        return {
          field: vgField(
            {
              // FIXME: this op might not already exist?
              // FIXME: what if dimensionChannel (x or y) contains custom domain?
              aggregate: isAggregate(model.encoding) ? s.op : undefined,
              field: s.field
            },
            {expr: 'datum'}
          )
        };
      } else if (isSortByEncoding(s)) {
        const fieldDefToSort = model.fieldDef(s.encoding);
        return {
          field: vgField(fieldDefToSort, {expr: 'datum'}),
          order: s.order
        };
      } else {
        return {
          field: vgField(dimensionChannelDef, {
            // For stack with imputation, we only have bin_mid
            binSuffix: model.stack && model.stack.impute ? 'mid' : undefined,
            expr: 'datum'
          })
        };
      }
    }
    return undefined;
  }
  return undefined;
}

function getMarkGroups(
  model: UnitModel,
  opt: {
    fromPrefix: string;
  } = {fromPrefix: ''}
) {
  const mark = model.mark;

  const clip = getFirstDefined(model.markDef.clip, scaleClip(model), projectionClip(model));
  const style = getStyles(model.markDef);
  const key = model.encoding.key;
  const sort = getSort(model);
  const interactive = interactiveFlag(model);

  const postEncodingTransform = markCompiler[mark].postEncodingTransform
    ? markCompiler[mark].postEncodingTransform(model)
    : null;

  return [
    {
      name: model.getName('marks'),
      type: markCompiler[mark].vgMark,
      ...(clip ? {clip: true} : {}),
      ...(style ? {style} : {}),
      ...(key ? {key: key.field} : {}),
      ...(sort ? {sort} : {}),
      ...(interactive ? interactive : {}),
      from: {data: opt.fromPrefix + model.requestDataName(MAIN)},
      encode: {
        update: markCompiler[mark].encodeEntry(model)
      },
      ...(postEncodingTransform
        ? {
            transform: postEncodingTransform
          }
        : {})
    }
  ];
}

/**
 * If scales are bound to interval selections, we want to automatically clip
 * marks to account for panning/zooming interactions. We identify bound scales
 * by the selectionExtent property, which gets added during scale parsing.
 */
function scaleClip(model: UnitModel) {
  const xScale = model.getScaleComponent('x');
  const yScale = model.getScaleComponent('y');
  return (xScale && xScale.get('selectionExtent')) || (yScale && yScale.get('selectionExtent')) ? true : undefined;
}

/**
 * If we use a custom projection with auto-fitting to the geodata extent,
 * we need to clip to ensure the chart size doesn't explode.
 */
function projectionClip(model: UnitModel) {
  const projection = model.component.projection;
  return projection && !projection.isFit ? true : undefined;
}

/**
 * Only output interactive flags if we have selections defined somewhere in our model hierarchy.
 */
function interactiveFlag(model: UnitModel) {
  if (!model.component.selection) return null;
  const unitCount = keys(model.component.selection).length;
  let parentCount = unitCount;
  let parent = model.parent;
  while (parent && parentCount === 0) {
    parentCount = keys(parent.component.selection).length;
    parent = parent.parent;
  }
  return parentCount ? {interactive: unitCount > 0} : null;
}
