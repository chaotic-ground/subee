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
        val versionString = "0.5.0" // x-release-please-version
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

    // CI release builds sign with a fixed keystore (from GitHub secrets) so
    // Obtainium can install updates over previous versions; local builds with
    // no keystore env fall back to the debug key.
    val releaseKeystore = System.getenv("SUBEE_KEYSTORE_FILE")
    if (releaseKeystore != null) {
        signingConfigs {
            create("release") {
                storeFile = file(releaseKeystore)
                storePassword = System.getenv("SUBEE_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("SUBEE_KEY_ALIAS")
                keyPassword = System.getenv("SUBEE_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig =
                if (releaseKeystore != null) {
                    signingConfigs.getByName("release")
                } else {
                    signingConfigs.getByName("debug")
                }
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
