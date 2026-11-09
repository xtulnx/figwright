/** Version-one capture/apply surface; also prevents arbitrary property writes from archives. */
export const BACKUP_NODE_FIELDS =
  `name visible locked x y width height relativeTransform rotation opacity blendMode
  isMask maskType effects fills strokes strokeWeight strokeAlign strokeCap strokeJoin dashPattern
  strokeMiterLimit strokeTopWeight strokeRightWeight strokeBottomWeight strokeLeftWeight
  cornerRadius cornerSmoothing topLeftRadius topRightRadius bottomLeftRadius bottomRightRadius
  layoutMode layoutWrap primaryAxisSizingMode counterAxisSizingMode primaryAxisAlignItems
  counterAxisAlignItems counterAxisAlignContent paddingLeft paddingRight paddingTop paddingBottom
  itemSpacing counterAxisSpacing strokesIncludedInLayout itemReverseZIndex layoutAlign layoutGrow layoutPositioning layoutSizingHorizontal
  layoutSizingVertical minWidth maxWidth minHeight maxHeight constraints clipsContent layoutGrids
  gridRowCount gridColumnCount gridRowGap gridColumnGap gridRowSizes gridColumnSizes
  gridRowAnchorIndex gridColumnAnchorIndex gridRowSpan gridColumnSpan gridChildHorizontalAlign
  gridChildVerticalAlign overflowDirection numberOfFixedChildren exportSettings reactions
  fillStyleId strokeStyleId effectStyleId gridStyleId boundVariables explicitVariableModes
  componentPropertyDefinitions componentProperties componentPropertyReferences overrides
  variantProperties description documentationLinks characters fontName fontSize textStyleId
  textAlignHorizontal textAlignVertical lineHeight letterSpacing textCase textDecoration
  textAutoResize textTruncation maxLines paragraphSpacing paragraphIndent textWrapStyle hyperlink
  listOptions hangingPunctuation hangingList openTypeFeatures vectorPaths vectorNetwork
  handleMirroring arcData pointCount innerRadius booleanOperation flowStartingPoints backgrounds
  prototypeBackgroundColor prototypeStartNodeID annotations`
    .split(/\s+/u)
    .filter(Boolean);
