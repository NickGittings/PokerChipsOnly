package com.nickgittings.pokerchipsonly;

import android.content.pm.ApplicationInfo;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Debuggable (debug) builds only: lets the web app's Capacitor.isPluginAvailable('DebugBuild') show developer tools.
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) registerPlugin(DebugBuildPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
