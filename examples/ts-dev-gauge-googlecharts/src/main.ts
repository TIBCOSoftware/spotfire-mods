/*
 * Copyright © 2020. TIBCO Software Inc.
 * This file is subject to the license terms contained
 * in the license file that is distributed with this file.
 */

import { googleGauge } from "./visualization";
// Import the Spotfire module
import { Spotfire } from "./api";
// Import needed types

// Starting point for every mod
Spotfire.initialize(async (mod) => {
    // Used later to inform Spotfire that the render is complete
    let context = mod.getRenderContext();

    // Create a reader object that reacts only data and window size changes
    let reader = mod.createReader(mod.visualization.data(), mod.windowSize());

    // Initialize the Google visualization
    let gauge = await googleGauge();

    reader.subscribe(async function render(dataView, size) {
        let errors = await dataView.getErrors();
        if (errors.length > 0) {
            // Data view contains errors. Display these and clear the chart to avoid
            // getting a flickering effect with an old chart configuration later.
            mod.controls.errorOverlay.show(errors, "DataView");
            gauge.clear();
            return;
        }

        mod.controls.errorOverlay.hide("DataView");
        let rows = await dataView.allRows();
        if (rows == null) {
            // Return and wait for next call to render when reading data was aborted.
            // Last rendered data view is still valid from a users perspective since
            // a document modification was made during a progress indication.
            return;
        }

        // Check for empty axis expression before.
        let hasCategory = (await dataView.categoricalAxis("Category")) != null;
        let hasMeasurement = (await dataView.continuousAxis("Measurement")) != null;

        // Transform the rows to the google visualization format.
        let data: [string, number][] = rows.map((row) => [
            hasCategory ? row.categorical("Category").formattedValue() : "",
            hasMeasurement ? row.continuous("Measurement").value() ?? 0 : 0
        ]);

        // Render the visualization using the transformed data
        gauge.render(data, size);

        // Add marking highlight using the marking color, if marking is enabled.
        let marking = await dataView.marking();
        let gauges = gauge.element.getElementsByTagName("td");
        rows.forEach((row, index) => {
            gauges[index].style.background =
                row.isMarked() && marking
                    ? "radial-gradient(" + marking.colorHexCode + " 50%, transparent 100%)"
                    : "transparent";
        });

        // Inform Spotfire that the render is complete (needed for export)
        context.signalRenderComplete();
    });
});
