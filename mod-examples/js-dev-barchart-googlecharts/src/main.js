//@ts-check - Get type warnings from the TypeScript language server. Remove if not wanted.

/**
 * Get access to the Spotfire Mod API by providing a callback to the initialize method.
 * @param {Spotfire.Mod} mod - mod api
 */
Spotfire.initialize(async mod => {
    /**
     * Create the read function - its behavior is similar to native requestAnimationFrame, except
     * it's triggered when one of the listened to values changes. We will be listening for data,
     * properties and window size changes.
     */
    const readerLoop = mod.reader(
        mod.visualization.data(),
        mod.visualization.property("orientation"),
        mod.visualization.property("stacking"),
        mod.visualization.windowSize()
    );

    const context = mod.getRenderContext();

    /**
     * Initiate the read loop
     */
    readerLoop(async function onChange(dataView, orientation, stacking) {
        await render(dataView, orientation, stacking);
        readerLoop(onChange);
    });

    /**
     * Aggregates incoming data and renders the chart
     *
     * @param {Spotfire.DataView} dataView
     * @param {Spotfire.Property} orientation
     * @param {Spotfire.Property} stacking
     */
    async function render(dataView, orientation, stacking) {
        /**
         * Load google charts library
         */
        await google.charts.load("current", { packages: ["corechart"] });

        /**
         * Check for any errors. 
         */
        if(await dataView.hasError())
        {
            /**
             * Here we should really clear the previous rendering
             * and display the message to the user.
             */
            console.log(await dataView.getError());
            return;
        }

        /**
         * Get rows from dataView
         */
        const rows = await dataView.getAllRows();

        /**
         * Get the color hierarchy.
         */
        const colorHierarchy = await dataView.getHierarchy("Color", true);
        const colorLeafNodes = await colorHierarchy.leaves();
        const colorDomain = colorHierarchy.isEmpty ? ["All Values"] : colorLeafNodes.map(node => node.fullName());

        /**
         * Get the x hierarchy.
         */
        const xHierarchy = await dataView.getHierarchy("X", true);
        const xLeafNodes = await xHierarchy.leaves();

        /**
         * Convert rows to a data table format expected by google chart
         * [
         * [SeriesNames,    Series1,    { role: "style" },  Series2,    { role: "style" }]
         * [Category1,      Value11,    Color11,            Value12,    Color12]
         * [Category2,      Value21,    Color21,            Value22,    Color22]
         * [Category3,      Value31,    Color31,            Value22,    Color22]
         * ...
         * ]
         */
        const dataColumns = ["Colors", ...colorDomain.flatMap(color => [{ label:color, "type":"number" }, { role: "style" }])];

        let dataRows = xLeafNodes.map(leaf => {
            /**
             * There may not be data in Spotfire for some combinations of color and x values, but the
             * above data table format requires it. So we create a row of the correct length where every
             * series has value null and an empty string for color.
             * We have one series for each value on color: [null, "", null, ""] etc.
             */
            var valueAndColorPairs = new Array(colorLeafNodes.length).fill([0, ""]).flat();
            
            /**
             * Fill in the combinations that are actually present in the data. The leafIndex in
             * the color hierarchy corresponds the the index of the series. We use that to
             * set the value and color in the array above. Combinations that do not exist in
             * the data will retain their value (null). Note that getValue() can also return null.
             */
            leaf.rows().forEach(r => {
                let colorIndex = !colorHierarchy.isEmpty ? r.categorical("Color").leafIndex : 0; 
                let yValue = r.continuous("Y").getValue();
                valueAndColorPairs[colorIndex * 2] = yValue;
                valueAndColorPairs[colorIndex * 2 + 1] = r.getColor().hexCode;
            });
            
            var row = [leaf.fullName(), ...valueAndColorPairs.flat()];
            return row;
        });

        /**
         * Build a google data table. 
         */
        let data;
        try {
            data = google.visualization.arrayToDataTable([dataColumns, ...dataRows]);
        } catch (e) {
            console.log(e);
        }

        /**
         * A helper function to compare a property against a certain value
         */
        const is = property => value => property.value == value;

        /**
         * Extract styling from mod render context
         */
        const styling = context.styling;
        const textStyle = {
            fontSize: styling.scales.font.fontSize,
            fontName: styling.scales.font.fontFamily,
            color: styling.scales.font.color
        };

        const baselineColor = styling.scales.line.stroke;
        const gridlines = { color: "transparent" };

        /**
         * Prepare options object taking into account the spotfire theme and mod properties
         */
        const options = {
            backgroundColor: { fill: "transparent" },
            legend: { position: "none" },
            bar: { groupWidth: "80%" },
            chartArea: { left: 85, top: 20, right: 10, bottom: 40 },
            isStacked: is(stacking)("stacked"),
            hAxis: {
                textStyle,
                baselineColor,
                gridlines
            },
            vAxis: {
                textStyle,
                baselineColor,
                gridlines,
                minValue: 0
            }
        };

        const container = document.querySelector("#mod-container");
        let chart;
        /**
         * Create a bar or column chart depending on `orientation` propery
         */
        if (is(orientation)("horizontal")) {
            chart = new google.visualization.BarChart(container);
        } else {
            chart = new google.visualization.ColumnChart(container);
        }

        /**
         * Draw the chart using data and options
         */
        chart.draw(data, options);

        /**
         * Add event listener for row selection
         */
        google.visualization.events.addListener(chart, "select", () => {
            const selection = chart.getSelection()[0];

            if (!selection) return;
            const { row, column } = selection;
            const xIndex = row;
            const colorIndex = (column - 1) / 2;
            selectRow(xIndex, colorIndex);
        });

        /**
         * Select a row by `x` and `color` indexes.
         */
        function selectRow(xIndex, colorIndex) {
            rows.forEach(row => {
                var rowColorIndex = !colorHierarchy.isEmpty ? row.categorical("Color").leafIndex : 0;
                var rowXIndex = !xHierarchy.isEmpty ?  row.categorical("X").leafIndex : 0;
                if (rowXIndex == xIndex && rowColorIndex == colorIndex) {
                    row.mark();
                }
            });
        }

        /**
         * Add click events for background and both axes
         */
        google.visualization.events.addListener(chart, "click", ({ targetID, x, y }) => {
            if (targetID == "chartarea") {
                dataView.clearMarking();
                return;
            }

            if (is(orientation)("vertical") && targetID.indexOf("hAxis") != -1) {
                showPopout({ x, y });
                return;
            }

            if (is(orientation)("horizontal") && targetID.indexOf("vAxis") != -1) {
                showPopout({ x, y });
                return;
            }
        });

        /**
         * Create a function to show a custom popout
         * Should be called when clicking on chart axes
         */
        const { popout } = mod.controls;
        const { divider, heading, radioButton } = popout.components;

        function showPopout(e) {
            popout.show(
                {
                    x: e.x,
                    y: e.y,
                    autoClose: true,
                    alignment: "Bottom",
                    onChange: popoutChangeHandler
                },
                popoutContent
            );
        }

        /**
         * Create popout content
         */
        const popoutContent = () => [
            heading("Chart Type"),
            radioButton({
                name: stacking.name,
                text: "Stacked bars",
                value: "stacked",
                checked: is(stacking)("stacked")
            }),
            radioButton({
                name: stacking.name,
                text: "Side-by-side bars",
                value: "side-by-side",
                checked: is(stacking)("side-by-side")
            }),
            divider(),
            heading("Orientation"),
            radioButton({
                name: orientation.name,
                text: "Vertical",
                value: "vertical",
                checked: is(orientation)("vertical")
            }),
            radioButton({
                name: orientation.name,
                text: "Horizontal",
                value: "horizontal",
                checked: is(orientation)("horizontal")
            })
        ];

        /**
         * Popout change handler
         * @param {Spotfire.Property} property
         */
        function popoutChangeHandler({ name, value }) {
            name == orientation.name && orientation.set(value);
            name == stacking.name && stacking.set(value);
        }

        /**
         * Trigger render complete when chart is ready
         */
        google.visualization.events.addListener(chart, "ready", () => context.signalRenderComplete());
    }
});
