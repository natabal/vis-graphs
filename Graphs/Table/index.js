import PropTypes from 'prop-types';
import React from 'react'
import DataTables from 'material-ui-datatables'
import CopyToClipboard from 'react-copy-to-clipboard'
import {Tooltip} from 'react-lightweight-tooltip'
import { last, isEqual, orderBy, isEmpty } from 'lodash'
import SuperSelectField from 'material-ui-superselectfield';
import Dialog from 'material-ui/Dialog';
import FlatButton from 'material-ui/FlatButton';

import MuiThemeProvider from "material-ui/styles/MuiThemeProvider";
import objectPath from "object-path";
import IconButton from 'material-ui/IconButton';
import RefreshIcon from 'material-ui/svg-icons/navigation/refresh';
import { FaRegEye as EyeIcon, FaRegClipboard } from 'react-icons/fa';

import { theme } from "../../theme";
import AbstractGraph from "../AbstractGraph"
import columnAccessor from "../../utils/columnAccessor"
import { toolTipStyle, firstRowToolTipStyle, lastColToolTipStyle, lastColFirstRowToolTipStyle, firstColFirstRowToolTipStyle, firstColToolTipStyle } from './tooltipStyle';
import "./style.css"
import style from './style'
import {properties} from "./default.config"
import { pick, expandExpression, labelToField } from '../../utils/helpers';
import { events } from '../../utils/types';
import SearchBar from "../../SearchBar";
import InfoBox from "../../InfoBox";

const PROPS_FILTER_KEY = ['data', 'height', 'width', 'context', 'selectedColumns', 'scrollData']
const STATE_FILTER_KEY = ['selected', 'data', 'fontSize', 'contextMenu', 'showInfoBox', 'showConfirmationPopup']

class Table extends AbstractGraph {

    constructor(props, context) {
        super(props, properties)
        this.handleSortOrderChange   = this.handleSortOrderChange.bind(this)
        this.handlePreviousPageClick = this.handlePreviousPageClick.bind(this)
        this.handleNextPageClick     = this.handleNextPageClick.bind(this)
        this.handleSearch            = this.handleSearch.bind(this)
        this.handleRowSelection      = this.handleRowSelection.bind(this)
        this.handleContextMenu       = this.handleContextMenu.bind(this)
        this.handleColumnSelection   = this.handleColumnSelection.bind(this)
        this.selectionColumnRenderer = this.selectionColumnRenderer.bind(this)
        this.onInfoBoxCloseHandler   = this.onInfoBoxCloseHandler.bind(this);

        this.columns = `${props.configuration.id}-columns`

        /**
        */
        const { limit } = this.getConfiguredProperties();
        this.pageSize =  limit || 500;
        this.searchText = '';
        this.scroll = props.scroll;
        this.originalData = []
        this.keyColumns = {}
        this.filterData = []
        this.selectedRows = {}
        this.htmlData = {}
        this.state = {
            selected: [],
            data: [],
            fontSize: style.defaultFontsize,
            contextMenu: null,
            columns: [],
            showInfoBox: false,
            showConfirmationPopup: false
        }
        this.tableWidth = 0;
        this.initiate(props);
    }

    static getDerivedStateFromProps(nextProps, prevState) {
        const {
            context,
            selectedColumns
        } = nextProps;

        const column = `${nextProps.configuration.id}-columns`;

        let columnsContext = false

        if(selectedColumns) {
            columnsContext = selectedColumns
        } else {
            columnsContext = context && context.hasOwnProperty(column) ? context[column] : false
        }

        if(prevState.columns.length !== columnsContext.length) {
            return Table.updateColumn(nextProps);
        } 
        return null;
    }

    componentDidMount() {
        this.initiate(this.props);
        this.checkFontsize();
    }

    shouldComponentUpdate(nextProps, nextState) {

        return !isEqual(pick(this.props, ...PROPS_FILTER_KEY), pick(nextProps, ...PROPS_FILTER_KEY))
            || !isEqual(pick(this.state, ...STATE_FILTER_KEY), pick(nextState, ...STATE_FILTER_KEY))
    }

    componentDidUpdate(prevProps) {
        if(prevProps.height !== this.props.height || prevProps.width !== this.props.width) {
            this.setState({ fontSize: style.defaultFontsize});
        }

        if((!isEqual(prevProps.data, this.props.data) || !isEqual(prevProps.scrollData, this.props.scrollData))
            && (prevProps.context && prevProps.context[this.columns] === this.props.context[this.columns])) {
            this.initiate(this.props);
        }
        
        this.checkFontsize();
        const { contextMenu } = this.state;
        if (contextMenu) {
            this.openContextMenu();
        }
    }

    getGraphProperties(props = this.props) {
        const {
            scrollData,
            data,
            size,
        } = props;

        // Total, per page, current page must be set and only applicable for Table component only.
        return {
            searchString: objectPath.has(scrollData, 'searchText') ? objectPath.get(scrollData, 'searchText') : null,
            sort: objectPath.has(scrollData, 'sort') ? objectPath.get(scrollData, 'sort') : null,
            size: size || data.length, // response length for normal table otherwise total hits for scroll based table.
            pageSize: objectPath.has(scrollData, 'pageSize') ? objectPath.get(scrollData, 'pageSize') : this.pageSize, // Calculate this from the config or (query in case of scroll)
            currentPage: objectPath.has(scrollData, 'currentPage') ? objectPath.get(scrollData, 'currentPage') : 1, // Pass page as 1 for Normal Table and will be handled internally only.
            expiration: objectPath.has(scrollData, 'expiration') ? objectPath.get(scrollData, 'expiration') : false,
        }
    }

    static updateColumn(props) {
        const column = `${props.configuration.id}-columns`;
        
        const {
            context,
            selectedColumns
        } = props;

        let columnsContext = false

        if(selectedColumns) {
            columnsContext = selectedColumns
        } else {
            columnsContext = context && context.hasOwnProperty(column) ? context[column] : false
        }

        const columns = props.configuration.data.columns.filter( d => {
            Object.assign(d, {value: d.label})

            //Only selected Columns
            if(columnsContext) {
                return columnsContext.indexOf(d.label) > -1 || false
            } else {
                //Configured Columns
                return d.display !== false
            }
        });

        return { columns }
    }

    // update scroll data on pagination, searching and sorting.
    updateTableStatus(param = {}) {
        const {
            updateScroll,
        } = this.props;
        updateScroll && updateScroll(param)
    }

    isEmptyData(data) {
        return isEmpty(data);
    }

    initiate(props) {
        const {
            context,
            selectedColumns,
            scroll,
            scrollData,
        } = props;

        const {
            currentPage,
            pageSize,
            size
        } = this.getGraphProperties(props);

        let startIndex = 0;
        let endIndex = size - 1;

        if(scroll) {
            startIndex = (currentPage - 1) * pageSize;
            endIndex = startIndex + pageSize - 1;
            this.selectedRows = objectPath.has(scrollData, 'selectedRows') ? objectPath.get(scrollData, 'selectedRows') : {};

            if (!objectPath.has(scrollData, 'pageSize')) {
                this.updateTableStatus({ pageSize: this.pageSize })
            }
        }

        const {
            selectColumnOption,
            matchingRowColumn,
            fixedHeader,
            headerPadding,
        } = this.getConfiguredProperties()

        const columns = this.getColumns();

        if (!columns)
            return;

        let columnNameList = []
        this.filterData    = []
        this.unformattedData = {}
        this.keyColumns = {}

        // generate random key for each column and assign that key to the values in data
        const types = {};
        columns.forEach( d => {
            if(!types[d.column]) {
                types[d.column] = 1;
            }

            if (fixedHeader) {
                d.size = this.labelSize(d.label || d.column, this.state.fontSize) + headerPadding;
            }

            columnNameList.push(d.column);
            this.keyColumns[ d.selection ? d.label : `${d.column}_${types[d.column]}`] = d;
            types[d.column]++;
        });

        props.data.forEach( (d, i) => {
            const random = this.generateRandom();
            const data = {
                'row_id': random
            };

            if(i >= startIndex && i <= endIndex) {
                for(let key in this.keyColumns) {
                    if(this.keyColumns.hasOwnProperty(key)) {
                        const columnData = Object.assign({}, this.keyColumns[key]);

                        delete columnData.totalCharacters;

                        const accessor = columnAccessor(columnData);
                        data[key] = accessor(d);

                        // add tooltip column data if it doesn't exist in column array
                        if(columnData.tooltip && !columnNameList.includes(columnData.tooltip.column)) {
                            data[columnData.tooltip.column] = columnAccessor({column: columnData.tooltip.column})(d)
                        }

                        // add matching row data if it doesn't exist in column array
                        if(matchingRowColumn && !columnNameList.includes(matchingRowColumn)) {
                            data[matchingRowColumn] = columnAccessor({column: matchingRowColumn})(d)
                        }
                    }
                }
            }

            this.filterData.push(data)
            this.unformattedData[random] = d;
        })

        this.originalData = this.filterData

        /*
         * On data change, resetting the paging and filtered data to 1 and false respectively.
         */
        this.resetFilters((currentPage || 1), this.selectedRows);
        let columnsContext = false

        if(selectedColumns) {
            columnsContext = selectedColumns
        } else {
            columnsContext = context && context.hasOwnProperty(this.columns) ? context[this.columns] : false
        }

        this.tableWidth = 0;

        // filter columns who will be display in table
        const filteredColumns = columns.filter(d => {
            Object.assign(d, { value: d.label })


            /**
             * !selectColumnOption: Must return all the columns
             * columnsContext && (columnsContext.indexOf(d.label) > -1): Only selected Columns
             * d.display !== false: Configured Columns
             */
            if (!selectColumnOption || (columnsContext && (columnsContext.indexOf(d.label) > -1)) || d.display !== false) {
                if (this.state.columns.filter(c => c.value === d.label).length) {
                    this.tableWidth += d.size;
                }

                return true;
            }

            return false;
        })

        if (filteredColumns.length) {
            filteredColumns[0].firstColStyle = firstColToolTipStyle;
            last(filteredColumns).lastColStyle = lastColToolTipStyle;
        }

        this.updateData(filteredColumns);
    }

    isScrollExpired() {
        const {
            expiration
        } = this.getGraphProperties();

        return this.scroll && expiration && expiration <= Date.now()
    }

    isScrollDataExists(page) {
        const {
            data
        } = this.props;

        const {
            pageSize,
        } = this.getGraphProperties();

        let startIndex = (page - 1) * pageSize;
        return startIndex < data.length;
    }

    decrementFontSize() {
        this.setState({
            fontSize: this.state.fontSize - 1
        })
    }

    checkFontsize() {
        if(this.container &&
            this.container.querySelector('table').clientWidth > this.container.clientWidth &&
            this.state.fontSize >= style.defaultFontsize
        ) {
            this.decrementFontSize();
        }
    }

    resetFilters(page = 1, selectedRows = {}) {
        this.currentPage = page;
        this.selectedRows = selectedRows;
    }

    handleSearch(data, isSuccess, expression = null, searchText = null) {
        if(isSuccess) {
            if(expression) {
                const {
                    searchString
                } = this.getGraphProperties();

                const search = labelToField(expandExpression(expression), this.getKeyColumns())
                this.filterData = data;

                if(!searchText || searchString !== searchText) {
                    this.updateTableStatus({search, searchText , selectedRows: {}, currentPage: 1, event: events.SEARCH})
                }
            } else {
                this.filterData = data;
                this.updateData();
                this.resetFilters();
            }
        }
    }

    updateData(columns = this.state.columns) {
        const {
            pageSize,
        } = this.getGraphProperties();

        const offset = pageSize * (this.currentPage - 1);
        this.setState({
            data : this.filterData.slice(offset, offset + pageSize),
            selected: this.selectedRows[this.currentPage] || [],
            columns
        });
    }

    getColumns() {
        const {
            configuration,
        } = this.props;

        return configuration.data.columns;
    }

    getKeyColumns() {
        return this.keyColumns;
    }

    // filter and formatting columns for table header
    getHeaderData(width) {

        const {
            headerPadding
        } = this.getConfiguredProperties();

        const { fixedHeader } = this.getConfiguredProperties();
        const columns = this.getKeyColumns();

        let headerData = [];
        let extraWidth = this.tableWidth;
        if (extraWidth < width) {
            extraWidth = (width - extraWidth)/this.state.columns.length;
        } else {
            extraWidth = 0;
        }
        const rowWidthDiff = fixedHeader && extraWidth;

        for(let index in columns) {
            if(columns.hasOwnProperty(index)) {
                const columnRow = columns[index];
                if(this.state.columns.filter( d => d.value === columnRow.label).length) {
                    const columnWidth = fixedHeader && (columnRow.size + (rowWidthDiff > 0 ? (rowWidthDiff - headerPadding * 0.4) : rowWidthDiff));

                    headerData.push({
                        key: index,
                        label: columnRow.label || columnRow.column,
                        sortable: columnRow.sort !== false,
                        columnText: columnRow.selection ? "" : (columnRow.label || columnRow.column),
                        columnField: index,
                        filter: columnRow.filter !== false,
                        type: columnRow.selection ? "selection" : "text",
                        style: {
                            textIndent: columnRow.hasOwnProperty('firstColStyle') ? '2px': '0px',
                            minWidth: columnWidth,
                            maxWidth: columnWidth,
                        }
                    })
                }
            }
        }

        return headerData
    }

    getTableData(columns) {
        const {
            highlight,
            highlightColor,
            fixedHeader,
            headerPadding,
        } = this.getConfiguredProperties();

        if(!columns)
            return []

        const keyColumns = this.getKeyColumns();

        return this.state.data.map((d, j) => {

            let rowWidth = 0;
            let data = {},
                highlighter = false;

            const keyData = this.replaceKeyFromColumn(d)

            for (let key in keyColumns) {
                if(keyColumns.hasOwnProperty(key)) {

                    const columnObj  = keyColumns[key],
                        originalData = d[key];
                    let columnData   = originalData;

                    // get substring of data upto defined total characters
                    if(columnObj.totalCharacters) {
                        columnData = columnAccessor({column: columnObj.column, totalCharacters: columnObj.totalCharacters})(keyData)
                    }

                    // get with of the column data
                    if (fixedHeader) {
                        const blockSize = this.labelSize(columnData, this.state.fontSize) + headerPadding;
                        if (columnObj.size < blockSize) {
                            columnObj.size = blockSize;
                        }
                        if (this.state.columns.filter(d => d.value === columnObj.label).length) {
                            rowWidth += columnObj.size;
                        }
                    }

                    // enable tooltip on mouse hover
                    if((columnData || columnData === 0) && columnObj.tooltip) {

                        let fullText = d[columnObj.tooltip.column] || originalData

                        fullText = Array.isArray(fullText) ? fullText.join(", ") : fullText

                        const hoverContent = (
                            <div key={`tooltip_${j}_${key}`}>
                                {fullText} &nbsp;
                                <CopyToClipboard text={fullText ? fullText.toString() : ''}>
                                    <button style={{background: '#000', padding: 1}} title="copy">
                                        <FaRegClipboard size={10} color="#fff" />
                                    </button>
                                </CopyToClipboard>
                            </div>
                        )

                        const firstColStyle = (columnObj.firstColStyle && j === 0 ? firstColFirstRowToolTipStyle : (columnObj.firstColStyle || false));
                        const lastColStyle = (columnObj.lastColStyle && j === 0 ? lastColFirstRowToolTipStyle : (columnObj.lastColStyle || false));
                        const colStyle = (j === 0 ? firstRowToolTipStyle : toolTipStyle);

                        columnData = (
                            <Tooltip key={`tooltip_${j}_${key}`}
                                content={[hoverContent]}
                                styles={firstColStyle || lastColStyle || colStyle}>
                                {columnData}
                            </Tooltip>
                        )
                    }

                    // highlight the entire row if highlight array have a column with non-empty value
                    if(highlight && highlight.includes(columnObj.column) && originalData) {
                        highlighter = true
                    }

                    /**
                     * indicate column value with colors,
                     *  if column value configured in color array as a key with given color as a value. For e.g. -
                     * color {"insla": "red", "outsla": "green"}
                     */
                    if (columnObj.colors && columnObj.colors[originalData]) {
                        columnData =  (
                            <div style={{ background:  columnObj.colors[originalData] || '', width: "10px", height: "10px", borderRadius: "50%", marginRight: "6px" }}></div>
                        )
                    }

                    if(columnObj.infoBox && columnData) {
                        columnData =  (
                            <div>
                                {columnData}
                                <span style={{padding: "0px 5px"}} onClick={(e) => {
                                    e.stopPropagation();
                                    this.openInfoBox({
                                        infoBoxRow: keyData,
                                        infoBoxColumn: columnObj.column,
                                        infoBoxData: originalData,
                                        infoBoxScript: columnObj.infoBox
                                    })
                                }}>
                                    <EyeIcon size={this.state.fontSize + 2} color="#555555" />
                                </span>
                            </div>
                        )
                    }

                    if(columnData || columnData === 0) {
                        // in certain cases the data is process incorrectly and the columns shows as an object.
                        // We do not support javascript object to display in a column
                        data[key] = typeof(columnData) === "boolean" ? columnData.toString().toUpperCase() :
                            (typeof columnData === "object") ? null : columnData;
                        
                        data[key] = <div className="wrapper-data"> {data[key]} </div>;
                        /**
                        * define the font color of the column value
                        */
                        if (columnObj.fontColor) {
                            data[key] = <div style={{ color: columnObj.fontColor }}> {data[key]} </div>;
                        }
                    }
                }
            }
            this.tableWidth = rowWidth;

            if(highlighter)
                Object.keys(data).map(key => {
                    return data[key] = <div style={{ background: highlightColor || '', height: style.row.height, padding: "10px 0" }}>
                        {data[key]}</div>
                })

            return data
        })
    }

    // when scroll is enabled then call this function
    handleScrollSorting(column, order) {
        const { sort } = this.getGraphProperties();
        let colOrder = 'asc';
        let colName = this.getColumnNameByKey(column);

        if (sort && sort.column === colName) {
            colOrder = sort.order === 'desc' ? 'asc' : 'desc';
        }

        this.updateTableStatus({
            sort: { column: colName, order: colOrder },
            currentPage: 1,
            selectedRows: {},
            event: events.SORTING
        })
    }

    handleStaticSorting(column, order) {
        this.filterData = orderBy(this.filterData, [column], [order]);
        /**
         * Resetting the paging due to sorting
         */
        this.resetFilters();
        this.updateData();
    }

    handleSortOrderChange(column, order) {
        this.scroll ? this.handleScrollSorting(column, order): this.handleStaticSorting(column, order)
    }

    handlePreviousPageClick() {
        --this.currentPage;
        this.scroll ? this.updateTableStatus({currentPage: this.currentPage,  event: events.PAGING}) : this.updateData();
    }

    handleNextPageClick() {
        // show confirmation popup to refresh data if scroll is enable
        if(this.isScrollExpired() && !this.isScrollDataExists(this.currentPage + 1)) {
            this.setState({showConfirmationPopup: true});
            return;
        }

        ++this.currentPage
        this.scroll ? this.updateTableStatus({currentPage: this.currentPage, event: events.PAGING}) : this.updateData();
    }

    handleClick(key) {
        if(this.props.onMarkClick && this.state.data[key])
            this.props.onMarkClick(this.unformattedData[this.state.data[key]['row_id']]);

    }

    handleRowSelection(selectedRows) {
        const {
            multiSelectable,
            matchingRowColumn
        } = this.getConfiguredProperties();

        if(!multiSelectable) {
            this.handleClick(...selectedRows)
            this.selectedRows = {}
        }

        this.selectedRows[this.currentPage] = selectedRows.slice();
        this.setState({
            selected: this.selectedRows[this.currentPage]
        })

        const { onSelect } = this.props;
        if (onSelect) {
            let matchingRows = [];
            let rows = {};
            const selectedData = this.getSelectedRows();

            if(selectedData.length > 1) {
                rows = selectedData;
            } else {
                let row =  selectedData.length ? selectedData[0] : {}
                /**
                 * Compare `matchingRowColumn` value with all available data and if equal to selected row,
                 * then save all matched records in store under "matchedRows",
                **/
                if(matchingRowColumn && row) {

                    const value = objectPath.get(row, matchingRowColumn)
                    matchingRows = this.props.data.filter( (d) => {
                        const matchingRowValue = objectPath.get(d, matchingRowColumn)
                        return (value || value === 0) && !isEqual(row, d) && value === matchingRowValue
                    });
                }
                rows = this.replaceKeyFromColumn(row)
            }
            onSelect({rows, matchingRows});
        }

        if(this.scroll)
            this.updateTableStatus({ selectedRows: this.selectedRows})

    }

    // replace random generated keys of columns from actual column name
    replaceKeyFromColumn(row) {
        const columns = this.getKeyColumns()
        let updatedRow = {}
        for (let key in row) {
            if(row.hasOwnProperty(key)) {
                objectPath.set(updatedRow, columns[key] ? columns[key].column : key, row[key]);
            }
        }
        return updatedRow
    }

    // pass column name and get column key (random generated at component will mount/ update)
    getKeyByColumnName(column) {
        const columns = this.getKeyColumns()
        for (let key in columns) {
            if(columns.hasOwnProperty(key) && columns[key].column === column) {
                return key
            }
        }
        return column;
    }

    getColumnNameByKey(key) {
        const columns = this.getKeyColumns()
        if (key && columns && columns[key]) {
            return columns[key].column
        }
        return key
    }

    getMenu() {
        const {
            menu,
            multiMenu
        } = this.getConfiguredProperties();

        if (multiMenu && this.getSelectedRows().length > 1) {
            return multiMenu
        }

        return menu || false
    }

    handleContextMenu(event) {
        const menu = this.getMenu()

        if (!menu) {
            return false;
        }
        event.preventDefault()
        const { clientX: x, clientY: y } = event;
        this.setState({ contextMenu: { x, y } });
        return true;
    }

    handleCloseContextMenu = () => {
        this.setState({ contextMenu: null });
        this.closeContextMenu();
    }

    closeContextMenu = () => {
        document.body.removeEventListener('click', this.handleCloseContextMenu);
        const node = document.getElementById('contextMenu');
        if (node) node.remove();
    }

    openContextMenu = () => {
        const { contextMenu: { x, y } } = this.state;
        const menu = this.getMenu()

        this.closeContextMenu();
        document.body.addEventListener('click', this.handleCloseContextMenu);

        const node = document.createElement('ul');
        node.classList.add('contextMenu');
        node.id = 'contextMenu';
        node.style = `top: ${y}px; left: ${x}px; z-index: 100000;`;

        const { goTo, context, configuration: { id } } = this.props;
        context.id = id;

        menu.forEach((item) => {
            const { text, rootpath, params } = item;
            const pathname = `${process.env.PUBLIC_URL}/${rootpath}`
            const li = document.createElement('li');
            li.textContent = text;
            const queryParams = (params && Object.getOwnPropertyNames(params).length > 0) ?
                    Object.assign({}, context, params) : Object.assign({}, context);
            li.onclick = (e) => {
                // dispatch a push to the menu link
                goTo && goTo(pathname, queryParams);
            };
            node.append(li);
        });
        document.body.append(node);
    }

    getSelectedRows() {
        const {
            pageSize
        } = this.getGraphProperties();

        let selected = [];
        for(let page in this.selectedRows) {
            if(this.selectedRows.hasOwnProperty(page)) {
                this.selectedRows[page].forEach((index) => {
                    selected.push(this.props.data[(page - 1) * pageSize + index])
                })
            }
        }
        return selected;
    }

    renderSearchBarIfNeeded(headerData) {
        const {
            searchString
        } = this.getGraphProperties();

        const {
            searchBar,
            searchText,
            autoSearch,
        } = this.getConfiguredProperties();

        if(searchBar === false)
            return;

        const search = searchString !== null ? searchString : searchText,
            filteroption = headerData.filter( d => d.filter === true);

        return (
            <SearchBar
                data={this.originalData}
                searchText={search}
                options={filteroption}
                handleSearch={this.handleSearch}
                columns={this.getColumns()}
                scroll={this.props.scroll}
                autoSearch={autoSearch}
            />
        );
    }

    removeHighlighter(data = []) {
        const {
            highlight
        } = this.getConfiguredProperties();

        if(!data.length)
            return data

        if(highlight) {
            this.state.selected.forEach( (key) => {
                if(highlight && data[key]) {
                    for (let i in data[key]) {
                        if (data[key].hasOwnProperty(i)) {
                            if(data[key][i].props.style)
                                data[key][i].props.style.background = ''
                        }
                    }
                }
            })
        }
        return data
    }


    handleColumnSelection(columns, name) {
        const {
            onColumnSelection,
            goTo,
            context
        } = this.props

        let columnsData = []
        columns.forEach( d => {columnsData.push(d.label)});

        delete context['query'];

        this.setState({ columns });
        if (onColumnSelection) {
            onColumnSelection({ [this.columns]: columnsData });
        } else {
            goTo && goTo(window.location.pathname, Object.assign({}, context, { [this.columns]: JSON.stringify(columnsData) }))
        }

    }

    getColumnListItem() {

        return this.getColumns().map(column => {
            return (
                <div style={{
                    whiteSpace: 'normal',
                    display: 'flex',
                    justifyContent: 'space-between',
                    lineHeight: 'normal',
                    fontSize: '0.8em'
                }}
                    key={column.label}
                    label={column.label}
                    value={column.label}>
                    {column.label}
                </div>
            )
        })
    }

    selectionColumnRenderer(values, hintText) {
        if (!values) return hintText
        const { value, label } = values
        if (Array.isArray(values)) {
            return values.length
                ? `Select Columns`
                : hintText
        }
        else if (label || value) return label || value
        else return hintText
    }

    filteredColumnBar(selectColumnOption = false) {
        const {
            id
        } = this.props

        if(!selectColumnOption) {
            return
        }

        const customHintTextAutocomplete = (
            <span style={{ fontSize: '0.8em' }}>Type something</span>
        )

        return (
            <div className={'select-column'} style={{flex: "none"}}>
                <SuperSelectField
                    name={id}
                    multiple
                    checkPosition='left'
                    hintTextAutocomplete={customHintTextAutocomplete}
                    hintText='Select Columns'
                    onSelect={this.handleColumnSelection}
                    value={this.state.columns}
                    keepSearchOnSelect
                    elementHeight={40}
                    selectionsRenderer={this.selectionColumnRenderer}
                    style={{ minWidth: 150, margin: 10, outline: 'white', fontSize: '1em'}}
                    innerDivStyle={{border: '1px solid #dad1d1'}}
                    underlineFocusStyle={{outline: 'white'}}
                    autocompleteStyle={{fontSize: '0.8em'}}
                    errorStyle={{fontSize: '0.8em'}}
                >
                    {this.getColumnListItem()}
                </SuperSelectField>
            </div>
        )
    }

    renderNoData() {
        const { data } = this.props;

        if(this.isEmptyData(data)) {
            return this.renderMessage('No data to visualize')
        }

        return null;
    }

    // reset scroll data.
    resetScrollData() {
        const { disableRefresh } = this.getConfiguredProperties();
        return (
            this.scroll && !disableRefresh ?
                <div style={{flex: "none"}}>
                    <IconButton
                        tooltip="Refresh"
                        tooltipPosition={'top-left'}
                        style={style.button.design}
                        onClick={ () => this.updateTableStatus({currentPage: 1, selectedRows: {}, event: events.REFRESH})}
                    >
                        <RefreshIcon color={style.button.icon.color} />
                    </IconButton>
                </div>
            : ''
        )
    }

    openInfoBox({
        infoBoxRow,
        infoBoxColumn,
        infoBoxData,
        infoBoxScript
    }) {
        this.setState({
            showInfoBox: true,
            infoBoxRow,
            infoBoxColumn,
            infoBoxData,
            infoBoxScript,
        });
    }

    onInfoBoxCloseHandler() {
        this.setState({
            showInfoBox: false,
        });
    }

    renderInfoBox() {
        const {
            Script
        } = this.props;

        let { showInfoBox, infoBoxRow, infoBoxColumn, infoBoxScript, infoBoxData  } = this.state;

        return (
            showInfoBox &&
            <InfoBox
                onInfoBoxClose={this.onInfoBoxCloseHandler}
            >
                <Script
                    row={infoBoxRow}
                    key={infoBoxColumn}
                    value={infoBoxData}
                    script={infoBoxScript}
                />
            </InfoBox>
        )
    }

    // show confirmation popup to refresh data if scroll is enable
    renderConfirmationDialog() {
        const actions = [
            <FlatButton
                label="Stay on Current Page"
                labelStyle={style.button.labelStyle}
                primary={true}
                onClick={ () => this.setState({showConfirmationPopup: false}) }
            />,
            <FlatButton
                label="Continue"
                labelStyle={style.button.labelStyle}
                primary={true}
                onClick={ () => this.updateTableStatus({currentPage: 1, selectedRows: {}, event: events.REFRESH}) }
            />,
        ];

        return (
            this.state.showConfirmationPopup &&
            <React.Fragment>
                <Dialog
                    title="Unable to fetch"
                    actions={actions}
                    modal={true}
                    contentClassName='dialogBody'
                    open={true}
                >
                    Due to inactivity, we are not able to process the next page. Please press "Continue", to reload the data from first page.
                </Dialog>
            </React.Fragment>
        );
    }

    getHeightMargin(showFooter) {
        const {
            configuration,
        } = this.props;

        const {
            searchBar,
            selectColumnOption,
            fixedHeader,
            disableRefresh,
        } = this.getConfiguredProperties();

        let heightMargin = showFooter ? 95 : 80;

        heightMargin = searchBar === false ? heightMargin * 0.4 : heightMargin;
        heightMargin = (selectColumnOption || (this.scroll && !disableRefresh)) ? heightMargin + 50 : heightMargin;
        heightMargin = fixedHeader ? heightMargin + 35 : heightMargin;

        return configuration.filterOptions ? heightMargin + 50 : heightMargin;
    }

    getInitialSort() {
        const {
            sort
        } = this.getGraphProperties();

        let initialSort = {};
        if (sort && sort.column && sort.order) {
            initialSort = {...sort, column: this.getKeyByColumnName(sort.column)}
        }

        return initialSort;
    }

    render() {
        const {
            width,
            height,
            scroll,
        } = this.props;
        
        const {
            selectable,
            multiSelectable,
            showCheckboxes,
            hidePagination,
            selectColumnOption,
            searchText,
            tableHeaderStyle,
            tableRowColumnStyle,
            tableRowStyle = {},
            fixedHeader,
            tableStyle = {}
        } = this.getConfiguredProperties();

        const {
            searchString,
            pageSize,
            size
        } = this.getGraphProperties();

        let tableData  = this.getTableData(this.getColumns());

        // overrite style of highlighted selected row
        tableData = this.removeHighlighter(tableData)

        const headerData = this.getHeaderData(width);
        const totalRecords = scroll ? size : this.filterData.length;
        const showFooter = (totalRecords <= pageSize && hidePagination !== false) ? false : true;
        const heightMargin = this.getHeightMargin(showFooter);
        const initialSort = this.getInitialSort();
        const tableBodyStyle = {
            height: `${height - heightMargin}px`,
            minWidth: fixedHeader && (this.tableWidth > width ? (this.tableWidth + 35): width),
            overflowX: fixedHeader ? "hidden": "auto"
        }
        
        return (
            <MuiThemeProvider muiTheme={theme}>
                <div ref={(input) => { this.container = input; }}
                    onContextMenu={this.handleContextMenu} 
                    >
                        <div style={{float:'right', display: 'flex', paddingRight: 15}}>
                            { this.resetScrollData() }
                            { this.filteredColumnBar(selectColumnOption) }
                        </div>
                        { this.renderConfirmationDialog()}
                        { this.renderInfoBox() }
                        <div style={{clear:"both"}}></div>

                        {this.renderSearchBarIfNeeded(headerData)}
                        {this.renderNoData()}
                        {
                            scroll && searchText && searchString === null ?
                            this.renderMessage("Filtering...")  : 
                            <DataTables
                                fixedHeader={fixedHeader}
                                columns={headerData}
                                data={tableData}
                                initialSort={initialSort}
                                showHeaderToolbar={false}
                                showFooterToolbar={showFooter}
                                selectable={selectable}
                                multiSelectable={multiSelectable}
                                selectedRows={this.state.selected}
                                showCheckboxes={showCheckboxes}
                                showRowSizeControls={false}
                                onNextPageClick={this.handleNextPageClick}
                                onPreviousPageClick={this.handlePreviousPageClick}
                                onSortOrderChange={this.handleSortOrderChange}
                                onRowSelection={this.handleRowSelection}
                                page={this.currentPage}
                                count={totalRecords}
                                rowSize={pageSize}
                                tableStyle={ fixedHeader ? { width: 'inherit', ...tableStyle} : {width: '100%',...tableStyle}}
                                tableHeaderColumnStyle={Object.assign({}, style.headerColumn, {fontSize: this.state.fontSize})}
                                tableHeaderStyle={{tableHeaderStyle}}
                                tableRowStyle={{...style.row, ...tableRowStyle}}
                                tableRowColumnStyle={Object.assign({}, style.rowColumn, {fontSize: this.state.fontSize}, tableRowColumnStyle ? tableRowColumnStyle : {})}
                                tableBodyStyle={tableBodyStyle}
                                footerToolbarStyle={style.footerToolbar}
                            />
                        }
                </div>
            </MuiThemeProvider>
        );
    }
}

Table.propTypes = {
    configuration: PropTypes.object,
    response: PropTypes.object
};

export default Table;
