plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "io.github.lens0021.subee"
    compileSdk = 34

    defaultConfig {
        applicationId = "io.github.lens0021.subee"
        minSdk = 26
        targetSdk = 34

        // Kept in sync with package.json by release-please
        val versionString = "0.2.1" // x-release-please-version
        versionName = versionString

        // Auto-calculate versionCode from versionName (e.g., 1.2.3 -> 10203)
        val parts = versionString.split(".")
        versionCode = parts[0].toInt() * 10000 + parts[1].toInt() * 100 + parts[2].toInt()
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Use debug signing config for development/testing releases.
            // Note: updates over an installed version require uninstall first,
            // since every CI run signs with a freshly generated debug key.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    applicationVariants.all {
        outputs.all {
            val outputImpl = this as com.android.build.gradle.internal.api.BaseVariantOutputImpl
            val buildType = buildType.name
            val version = versionName
            outputImpl.outputFileName = "subee-$buildType-$version.apk"
        }
    }
}

dependencies {
    implementation(libs.kotlin.stdlib)
    implementation(libs.coroutines.android)
    implementation(libs.webkit)
    implementation(libs.work.runtime.ktx)
}
