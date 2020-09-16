/*
 * Copyright © 2020. TIBCO Software Inc.
 * This file is subject to the license terms contained
 * in the license file that is distributed with this file.
 */

// Manually import the array polyfills because the API is using functions not supported in IE11.
import "core-js/es/array";

//@ts-check - Get type warnings from the TypeScript language server. Remove if not wanted
/**
 * Get access to the Spotfire Mod API by providing a callback to the initialize method.
 * @param {Spotfire.Mod} mod - mod api
 */
Spotfire.initialize(async (mod) => {
    /**
     * Create the read function.
     */
    const reader = mod.createReader(mod.visualization.data(), mod.windowSize(), mod.property("myProperty"));

    /**
     * Store the context.
     */
    const context = mod.getRenderContext();

    /**
     * Initiate the read loop
     */
    reader.subscribe(render);

    /**
     * @param {Spotfire.DataView} dataView
     * @param {Spotfire.Size} windowSize
     * @param {Spotfire.ModProperty<string>} prop
     */
    async function render(dataView, windowSize, prop) {
        /**
         * Print out to document
         */
        const container = document.querySelector("#mod-container");

        let errors = await dataView.getErrors();
        if (errors.length > 0) {
            // Data view contains errors. Display these and clear the chart to avoid
            // getting a flickering effect with an old chart configuration later.
            mod.controls.errorOverlay.show(errors, "DataView");
            container.innerHTML = "";
            return;
        }
        mod.controls.errorOverlay.hide("DataView");

        /**
         * Get rows from dataView
         */
        const rows = await dataView.allRows();
        if (rows == null) {
            // Return and wait for next call to render when reading data was aborted.
            // Last rendered data view is still valid from a users perspective since
            // a document modification was made during an progress indication.
            return;
        }

        container.innerHTML = "";
        printResult(`windowSize: ${windowSize.width}x${windowSize.height}`);
        printResult(`should render: ${rows.length} rows`);
        printResult(`${prop.name}: ${prop.value()}`);

        /**
         * Signal that the mod is ready for export.
         */
        context.signalRenderComplete();

        function printResult(text) {
            let div = document.createElement("div");
            div.textContent = text;
            container.appendChild(div);
        }
    }
});
